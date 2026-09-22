begin;
-- A recurring template/date has exactly one canonical dated occurrence. No backfill.
create table if not exists private.hq_template_occurrences (
 org_id text not null, template_id text not null, occurrence_day date not null,
 post_id text not null, actor text not null, created_at timestamptz not null default now(),
 primary key(org_id,template_id,occurrence_day), unique(org_id,post_id)
);
alter table private.hq_template_occurrences enable row level security;
revoke all on private.hq_template_occurrences from public,anon,authenticated;

create or replace function private.hq_template(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); source jsonb; d jsonb:=payload->'data'; i text:=payload->>'id'; template text:=payload->>'templateId'; day date; existing text;
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>150000 or coalesce(i,'') !~ '^[a-zA-Z0-9_-]{1,180}$' or coalesce(template,'') !~ '^[a-zA-Z0-9_-]{1,180}$' or jsonb_typeof(d) is distinct from 'object' then raise exception using errcode='22023',message='Choose a saved recurring template and valid draft.'; end if;
 select data into source from public.marketing_records where workspace_id=w and kind='post' and id=template;
 if source is null or source->>'recurrence' is distinct from 'weekly-tuesday' or source ? 'radarId' or source ? 'consignment' then raise exception using errcode='22023',message='Recurring template was not found in this workspace.'; end if;
 perform private.consignment_time(d->>'date'); day:=(d->>'date')::timestamp::date;
 if extract(dow from day)<>2 then raise exception using errcode='22023',message='Choose a Tuesday for this template occurrence.'; end if;
 select post_id into existing from private.hq_template_occurrences where org_id=w and template_id=template and occurrence_day=day;
 if existing is not null then return jsonb_build_object('id',existing,'existing',true); end if;
 if source is distinct from payload->'source' then raise exception using errcode='40001',message='The series changed. Reload it before creating a draft.'; end if;
 if d->>'status' is distinct from 'draft' or d ?| array['recurrence','radarId','radarOrg','radarVersion','consignment'] or jsonb_typeof(d->'title') is distinct from 'string' or length(btrim(d->>'title')) not between 1 and 500 or d->>'timezone' is distinct from 'America/Chicago' or jsonb_typeof(d->'caption') is distinct from 'string' or length(d->>'caption')>10000 then raise exception using errcode='22023',message='A template occurrence must start as a dated draft.'; end if;
 if exists(select 1 from public.marketing_records where workspace_id=w and kind='post' and id=i) then raise exception using errcode='22023',message='This draft ID is already in use. Reload the calendar.'; end if;
 perform private.save_record('post',i,d);
 insert into private.hq_template_occurrences(org_id,template_id,occurrence_day,post_id,actor) values(w,template,day,i,s);
 return jsonb_build_object('id',i,'existing',false);
end $$;
create or replace function public.hub_hq_template(p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.hq_template(p_payload)$$;
revoke all on function private.hq_template(jsonb),public.hub_hq_template(jsonb) from public,anon,authenticated;
grant execute on function private.hq_template(jsonb),public.hub_hq_template(jsonb) to authenticated;

-- Validate future calendar writes, without altering preserved historical rows.
create or replace function private.hq_calendar_time_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.data->>'date' is not distinct from new.data->>'date' and old.data->>'recurrence' is not distinct from new.data->>'recurrence' then return new; end if;
 perform private.consignment_time(new.data->>'date');
 if new.data->>'recurrence'='weekly-tuesday' and extract(dow from (new.data->>'date')::timestamp)<>2 then raise exception using errcode='22023',message='Choose a Tuesday for this weekly series.'; end if;
 return new;
end $$;
revoke all on function private.hq_calendar_time_guard() from public,anon,authenticated;
drop trigger if exists hq_calendar_time_guard on public.marketing_records;
create trigger hq_calendar_time_guard before insert or update on public.marketing_records for each row when(new.kind='post') execute function private.hq_calendar_time_guard();
-- Explicit handoff of an approved editorial/calendar source into canonical HQ work.
create or replace function private.hq_editorial_handoff(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); old jsonb; q public.radar_editorial; d jsonb; i text; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if not(private.staff_role()='admin' or private.hq_capability(w,s,'coordinate_requests')) then raise exception using errcode='42501',message='A request coordinator or administrator must hand off editorial work.'; end if;
 select id into i from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'legacyPostId'=payload->>'id';
 if i is not null then return jsonb_build_object('id',i); end if;
 select data into old from public.marketing_records where workspace_id=w and kind='post' and id=payload->>'id';
 select * into q from public.radar_editorial where org_id=w and kind='queue' and id=old->>'radarId';
 if old is null or q.id is null or q.data->>'state' is distinct from 'Approved' or old->>'radarOrg' is distinct from w or old->'radarVersion' is distinct from to_jsonb(q.version) or old->>'status' is distinct from 'approved' then raise exception using errcode='22023',message='Approve the current editorial source and add it to the calendar before handoff.'; end if;
 if not private.hq_active(w,payload->>'owner') or not private.hq_active(w,payload->>'approver') then raise exception using errcode='22023',message='Choose an active accountable owner and standalone approver.'; end if;
 d:=jsonb_build_object('title',old->>'title','instructions','','owner',payload->>'owner','contributors','[]'::jsonb,'projectId','','approver',payload->>'approver','productionDue','','publishAt',private.hq_time(old->>'date'),'format','','platforms',jsonb_build_array(old->>'source'),'caption',coalesce(old->>'caption',''),'destinationUrl','','effort',payload->>'effort','estimatedHours',null,'publishing',true,'blocked',false,'blockedReason','','blockedBy','','assets',case when coalesce(q.data->>'assetId','')<>'' then jsonb_build_array(q.data->>'assetId') else '[]'::jsonb end,'references',coalesce(q.data->'references','[]'::jsonb),'evidence','{}'::jsonb,'assetRoles','{}'::jsonb,'linkRoles','{}'::jsonb,'publisher','','requiresFinalFile',true,'requiresCaption',true,'promotionMode','organic','promotionChannel','','promotionCents',0);
 i:=gen_random_uuid()::text;result:=private.hq('save-deliverable',jsonb_build_object('id',i,'version',0,'data',d));
 d:=(result->'data')||jsonb_build_object('legacyPostId',payload->>'id','legacyPost',old,'legacyEditorialId',q.id,'editorialSource',jsonb_build_object('version',q.version,'data',q.data));
 return private.hq_put(w,'deliverable',i,d,'editorial source handed off; owner approval and publication remain unconfirmed');
end $$;
create or replace function public.hub_hq_editorial(p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.hq_editorial_handoff(p_payload)$$;
revoke all on function private.hq_editorial_handoff(jsonb),public.hub_hq_editorial(jsonb) from public,anon,authenticated;
grant execute on function private.hq_editorial_handoff(jsonb),public.hub_hq_editorial(jsonb) to authenticated;

-- Source edits preserve the old calendar snapshot and require fresh HQ owner review.
create or replace function private.editorial_history() returns trigger language plpgsql security definer set search_path='' as $$
declare row record; d jsonb;
begin
 insert into public.radar_editorial_history(org_id,id,kind,record_id,data,version,actor,created_at)
 values(new.org_id,gen_random_uuid()::text,new.kind,new.id,new.data,new.version,new.actor,new.updated_at);
 if new.kind='queue' then
  update public.marketing_records post set data=jsonb_set(post.data,'{status}','"review"'::jsonb),updated_at=now()
  where post.workspace_id=new.org_id and post.kind='post' and post.data->>'radarId'=new.id
   and not exists(select 1 from public.marketing_records hq where hq.workspace_id=new.org_id and hq.kind='deliverable' and hq.data->>'legacyPostId'=post.id);
  for row in select id,data from public.marketing_records where workspace_id=new.org_id and kind='deliverable' and data->>'legacyEditorialId'=new.id loop
   -- Fully published work is permanent history, not a new pending publication.
   if not exists(select 1 from jsonb_each(row.data->'publications') where value->>'status'<>'published') then continue; end if;
   d:=row.data||jsonb_build_object('approval',null,'submission',null,'status',case when row.data->>'status' in ('ready','needs_review') then 'in_progress' else row.data->>'status' end,'version',(row.data->>'version')::int+1,'contentVersion',coalesce((row.data->>'contentVersion')::int,0)+1,'updatedAt',now(),'editorialSource',jsonb_build_object('version',new.version,'data',new.data));
   perform private.hq_put(new.org_id,'deliverable',row.id,d,'editorial source changed; compare current source and submit for renewed owner review');
   perform private.hq_notify(new.org_id,private.hq_approver(d,(select data from public.marketing_records where workspace_id=new.org_id and kind='project' and id=d->>'projectId')),'editorial:'||new.id||':'||new.version||':'||row.id,'review','deliverable',row.id,'Editorial source changed: '||(d->>'title'));
   perform private.hq_notify(new.org_id,d->>'owner','editorial:'||new.id||':'||new.version||':'||row.id,'review','deliverable',row.id,'Editorial source changed: '||(d->>'title'));
  end loop;
 end if;
 return new;
end $$;
create or replace function private.hq_editorial_approval_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare q public.radar_editorial;
begin
 if new.data->>'status'='ready' then
  select * into q from public.radar_editorial where org_id=new.workspace_id and kind='queue' and id=new.data->>'legacyEditorialId';
  if q.id is null or q.data->>'state' is distinct from 'Approved' or new.data->'editorialSource'->'version' is distinct from to_jsonb(q.version) then raise exception using errcode='22023',message='The current editorial source needs approval before HQ owner approval or publishing.'; end if;
 end if;
 return new;
end $$;
revoke all on function private.editorial_history(),private.hq_editorial_approval_guard() from public,anon,authenticated;
drop trigger if exists hq_editorial_approval_guard on public.marketing_records;
create trigger hq_editorial_approval_guard before insert or update on public.marketing_records for each row when(new.kind='deliverable' and new.data ? 'legacyEditorialId') execute function private.hq_editorial_approval_guard();

create or replace function private.calendar(p_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); draft public.radar_editorial; d jsonb; hq_id text;
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 select id into hq_id from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'legacyEditorialId'=p_id;
 if hq_id is not null then return jsonb_build_object('ok',true,'hqId',hq_id); end if;
 select * into draft from public.radar_editorial where org_id=w and kind='queue' and id=p_id for share;
 if not found then raise exception using errcode='P0002',message='Draft unavailable.'; end if;
 if draft.data->>'state' is distinct from 'Approved' or coalesce(draft.data->>'calendarDate','')='' then raise exception using errcode='22023',message='Approve the draft and choose a calendar date first.'; end if;
 d:=jsonb_build_object('title',draft.data->>'title','date',draft.data->>'calendarDate','timezone','America/Chicago','source',draft.data->>'calendarChannel',
  'caption',(case when draft.data->>'calendarChannel'='facebook' then draft.data->>'facebook' else draft.data->>'instagram' end)||E'\n\n'||(draft.data->>'cta'),
  'status','approved','radarOrg',w,'radarId',p_id,'radarVersion',draft.version);
 insert into public.marketing_records(workspace_id,kind,id,data) values(w,'post','radar_'||p_id,d)
 on conflict(workspace_id,kind,id) do update set data=excluded.data,updated_at=now();
 return jsonb_build_object('ok',true);
end $$;

commit;
