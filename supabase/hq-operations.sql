begin;
-- No backfill: historical records do not manufacture notifications or actual spending.
create table if not exists public.hq_notifications (
 org_id text not null, id uuid not null default gen_random_uuid(), recipient text not null,
 event_key text not null, category text not null check(category in ('assignment','review','mention','deadline')),
 kind text not null check(kind in ('project','deliverable','request')), record_id text not null,
 message text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now(),
 read_at timestamptz, resolved_at timestamptz, primary key(org_id,id), unique(org_id,recipient,event_key),
 foreign key(org_id,recipient) references private.staff_access(org_id,id)
);
create index if not exists hq_notifications_inbox on public.hq_notifications(org_id,recipient,created_at desc,id);
alter table public.hq_notifications enable row level security;
revoke all on public.hq_notifications from public,anon,authenticated;
grant select on public.hq_notifications to authenticated;
-- hq_staff_id is intentionally private; this checked predicate exposes no other identity.
create or replace function private.hq_own_notification(w text,s text) returns boolean language sql stable security definer set search_path='' as $$
 select w=private.workspace() and s=private.hq_staff_id()
$$;
revoke all on function private.hq_own_notification(text,text) from public,anon,authenticated;
grant execute on function private.hq_own_notification(text,text) to authenticated;
drop policy if exists recipient_read on public.hq_notifications;
create policy recipient_read on public.hq_notifications for select to authenticated using(private.hq_own_notification(org_id,recipient));

create table if not exists public.hq_spend (
 org_id text not null, id uuid not null, project_id text not null,
 category text not null check(category in ('advertising','creative')), amount_cents bigint not null check(amount_cents<>0 and abs(amount_cents)<=999999999999),
 channel text not null default '', spent_on date not null, note text not null check(length(btrim(note)) between 1 and 2000),
 actor text not null, created_at timestamptz not null default now(), reverses uuid,
 primary key(org_id,id), unique(org_id,reverses), foreign key(org_id,reverses) references public.hq_spend(org_id,id),
 check((reverses is null and amount_cents>0) or (reverses is not null and amount_cents<0))
);
create index if not exists hq_spend_project on public.hq_spend(org_id,project_id,created_at desc,id);
alter table public.hq_spend enable row level security;
revoke all on public.hq_spend from public,anon,authenticated;
grant select on public.hq_spend to authenticated;
drop policy if exists staff_read on public.hq_spend;
create policy staff_read on public.hq_spend for select to authenticated using(org_id=(select private.workspace()));
alter table public.hq_comments add column if not exists mentions jsonb not null default '[]';

create or replace function private.hq_notify(w text,s text,ek text,cat text,k text,i text,msg text,meta jsonb default '{}') returns void language plpgsql set search_path='' as $$
begin
 if not private.hq_active(w,s) then return; end if;
 insert into public.hq_notifications(org_id,recipient,event_key,category,kind,record_id,message,metadata)
 values(w,s,ek,cat,k,i,msg,meta) on conflict(org_id,recipient,event_key) do nothing;
end $$;

create or replace function private.hq_record_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare before_data jsonb:=case when tg_op='UPDATE' then old.data else '{}'::jsonb end;
 d jsonb:=new.data; s text; previous text; field text; role_name text; p jsonb; row record;
 ek text:=new.kind||':'||new.id||':'||coalesce(new.data->>'version','0');
begin
 -- Trigger runs only on canonical records. Clients cannot write this table directly.
 foreach field in array case when new.kind='project' then array['owner'] else array['owner','publisher','approver','blockedBy'] end loop
  s:=d->>field; previous:=before_data->>field;
  if field='blockedBy' and d->'blocked' is distinct from 'true'::jsonb then s:=''; end if;
  if field='blockedBy' and before_data->'blocked' is distinct from 'true'::jsonb then previous:=''; end if;
  if s is distinct from previous then
   role_name:=case field when 'blockedBy' then 'block resolver' when 'owner' then 'owner' when 'publisher' then 'publisher' else 'approver' end;
   perform private.hq_notify(new.workspace_id,s,ek||':'||field||':assigned','assignment',new.kind,new.id,'Assigned as '||role_name||': '||(d->>'title'));
   perform private.hq_notify(new.workspace_id,previous,ek||':'||field||':removed','assignment',new.kind,new.id,'Reassigned from you ('||role_name||'): '||(d->>'title'));
  end if;
 end loop;
 field:=case when new.kind='project' then 'members' else 'contributors' end;
 for s in select value from jsonb_array_elements_text(coalesce(d->field,'[]')) where not coalesce(before_data->field,'[]') ? value loop
  perform private.hq_notify(new.workspace_id,s,ek||':'||field||':assigned','assignment',new.kind,new.id,'Added to the team: '||(d->>'title'));
 end loop;
 for s in select value from jsonb_array_elements_text(coalesce(before_data->field,'[]')) where not coalesce(d->field,'[]') ? value loop
  perform private.hq_notify(new.workspace_id,s,ek||':'||field||':removed','assignment',new.kind,new.id,'Removed from the team: '||(d->>'title'));
 end loop;
 if new.kind='project' and d->>'owner' is distinct from before_data->>'owner' then
  for row in select id,data from public.marketing_records where workspace_id=new.workspace_id and kind='deliverable' and data->>'projectId'=new.id and data->>'status'='needs_review' loop
   perform private.hq_notify(new.workspace_id,d->>'owner',ek||':review:'||row.id,'review','deliverable',row.id,'Awaiting your review: '||(row.data->>'title'));
  end loop;
 elsif new.kind='deliverable' then
  select data into p from public.marketing_records where workspace_id=new.workspace_id and kind='project' and id=d->>'projectId';
  if d->>'status'='needs_review' and (before_data->>'status' is distinct from 'needs_review' or before_data->'submission' is distinct from d->'submission') then
   perform private.hq_notify(new.workspace_id,private.hq_approver(d,p),ek||':review-request','review',new.kind,new.id,'Review requested: '||(d->>'title'),jsonb_build_object('contentVersion',d->'contentVersion'));
  end if;
  if d->'review' is distinct from before_data->'review' and jsonb_typeof(d->'review')='object' then
   for s in select distinct value from jsonb_array_elements_text(jsonb_build_array(d->>'owner',d->>'publisher',before_data->'submission'->>'by')||coalesce(d->'contributors','[]')) loop
    perform private.hq_notify(new.workspace_id,s,ek||':review-result','review',new.kind,new.id,case when d->'review'->>'decision'='approve' then 'Approved: ' else 'Changes requested: ' end||(d->>'title'),jsonb_build_object('reviewedVersion',d->'review'->'reviewedVersion','comment',d->'review'->'comment'));
   end loop;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists hq_record_notifications on public.marketing_records;
create trigger hq_record_notifications after insert or update on public.marketing_records for each row when(new.kind in ('project','deliverable')) execute function private.hq_record_notifications();

create or replace function private.hq_mention_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare s text; title text;
begin
 if jsonb_typeof(new.mentions)<>'array' or jsonb_array_length(new.mentions)>50 then raise exception using errcode='22023',message='Choose up to 50 people to mention.'; end if;
 select data->>'title' into title from public.marketing_records where workspace_id=new.org_id and kind=new.kind and id=new.record_id;
 for s in select distinct value from jsonb_array_elements_text(new.mentions) loop
  if not private.hq_active(new.org_id,s) then raise exception using errcode='22023',message='Mention active people in this organization.'; end if;
  perform private.hq_notify(new.org_id,s,'comment:'||new.id,'mention',new.kind,new.record_id,'Mentioned in a comment: '||coalesce(title,'Work record'),jsonb_build_object('commentId',new.id,'actor',new.actor));
 end loop;
 return new;
end $$;
drop trigger if exists hq_mention_notifications on public.hq_comments;
create trigger hq_mention_notifications after insert on public.hq_comments for each row execute function private.hq_mention_notifications();

-- Called only with authenticated server time. No privileged scheduler or service credential is introduced.
create or replace function private.hq_reminders(w text,s text,clock_at timestamptz) returns integer language plpgsql set search_path='' as $$
declare r record; d jsonb; p jsonb; field text; wall text; due_at timestamptz; phase text; ek text; title text; platform text;
 active_keys text[]:='{}'; inserted integer:=0; before_count integer;
begin
 select count(*) into before_count from public.hq_notifications where org_id=w and recipient=s and category='deadline';
 for r in select kind,id,data from public.marketing_records where workspace_id=w and kind in ('project','deliverable') loop
  d:=r.data;
  if r.kind='project' then
   if d->>'status' in ('completed','archived') or not coalesce(d->>'owner'=s or d->'members'?s,false) then continue; end if;
   foreach field in array array['eventAt','auctionOpensAt','auctionClosesAt'] loop
    wall:=private.hq_time(d->>field); if wall='' then continue; end if;
    due_at:=private.consignment_time(wall); if due_at>clock_at+interval '24 hours' then continue; end if;
    phase:=case when due_at<clock_at then 'missed' else 'approaching' end;
    title:=case field when 'eventAt' then 'Project key date' when 'auctionOpensAt' then 'Auction opening' else 'Auction closing' end;
    ek:='deadline:project:'||r.id||':'||field||':'||wall||':'||phase; active_keys:=array_append(active_keys,ek);
    perform private.hq_notify(w,s,ek,'deadline',r.kind,r.id,title||' '||case when phase='missed' then 'has passed' else phase end||': '||(d->>'title'),jsonb_build_object('dueAt',wall,'field',field));
   end loop;
  else
   select data into p from public.marketing_records where workspace_id=w and kind='project' and id=d->>'projectId';
   if p->>'status' in ('completed','archived') or d->>'status'='done' then continue; end if;
   if d->>'status' not in ('ready','done') and coalesce(d->>'owner'=s or d->'contributors'?s or (d->>'status'='needs_review' and private.hq_approver(d,p)=s) or (d->'blocked'='true'::jsonb and d->>'blockedBy'=s),false) then
    wall:=private.hq_time(d->>'productionDue');
    if wall<>'' then
     due_at:=private.consignment_time(wall);
     if due_at<=clock_at+interval '24 hours' then
      phase:=case when due_at<clock_at then 'missed' else 'approaching' end; ek:='deadline:deliverable:'||r.id||':productionDue:'||wall||':'||phase; active_keys:=array_append(active_keys,ek);
      perform private.hq_notify(w,s,ek,'deadline',r.kind,r.id,'Production deadline '||phase||': '||(d->>'title'),jsonb_build_object('dueAt',wall,'field','productionDue'));
     end if;
    end if;
   end if;
   if d->'publishing'='true'::jsonb and d->>'publisher'=s then
    for platform in select key from jsonb_each(d->'publications') where value->>'status'<>'published' loop
     wall:=private.hq_time(coalesce(d->'publications'->platform->>'scheduledFor',d->>'publishAt')); if wall='' then continue; end if;
     due_at:=private.consignment_time(wall); if due_at>clock_at+interval '24 hours' then continue; end if;
     phase:=case when due_at<clock_at then 'missed' else 'approaching' end; ek:='deadline:deliverable:'||r.id||':'||platform||':'||wall||':'||phase; active_keys:=array_append(active_keys,ek);
     perform private.hq_notify(w,s,ek,'deadline',r.kind,r.id,platform||' publication '||phase||': '||(d->>'title'),jsonb_build_object('dueAt',wall,'platform',platform));
    end loop;
   end if;
  end if;
 end loop;
 update public.hq_notifications set resolved_at=clock_at where org_id=w and recipient=s and category='deadline' and resolved_at is null and not(event_key=any(active_keys));
 update public.hq_notifications set resolved_at=null,read_at=null where org_id=w and recipient=s and category='deadline' and resolved_at is not null and event_key=any(active_keys);
 select count(*)-before_count into inserted from public.hq_notifications where org_id=w and recipient=s and category='deadline';
 return inserted;
end $$;

create or replace function private.hq_operations(act text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); i text:=payload->>'id'; d jsonb; p jsonb; old jsonb; v int; row record; existing public.hq_spend; entry public.hq_spend; comment public.hq_comments; offset_n int; total jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>150000 then raise exception using errcode='22023',message='Check request fields.'; end if;
 if act='notification-list' then
  if coalesce(payload->>'offset','0') !~ '^\d{1,8}$' then raise exception using errcode='22023',message='Choose a valid notification page.'; end if;
  offset_n:=coalesce((payload->>'offset')::int,0);
  return jsonb_build_object('unread',(select count(*) from public.hq_notifications where org_id=w and recipient=s and read_at is null and resolved_at is null),'items',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from public.hq_notifications where org_id=w and recipient=s order by created_at desc,id limit 25 offset offset_n) x),'nextOffset',case when (select count(*) from public.hq_notifications where org_id=w and recipient=s)>offset_n+25 then offset_n+25 else null end);
 end if;
 if act='reminders' then return jsonb_build_object('generated',private.hq_reminders(w,s,now()),'checkedAt',now(),'mode','while_open'); end if;
 if act='notification-read' then
  if jsonb_typeof(payload->'read') is distinct from 'boolean' then raise exception using errcode='22023',message='Choose read or unread.'; end if;
  update public.hq_notifications set read_at=case when payload->'read'='true'::jsonb then coalesce(read_at,now()) else null end where org_id=w and recipient=s and id=i::uuid;
  if not found then raise exception using errcode='42501',message='Only the recipient can change this notification.'; end if; return '{}'::jsonb;
 end if;
 if act='comment' then
  if coalesce(payload->>'kind','') not in ('project','deliverable','request') or not exists(select 1 from public.marketing_records where workspace_id=w and kind=payload->>'kind' and id=i) then raise exception using errcode='22023',message='Record was not found.'; end if;
  if coalesce(length(btrim(payload->>'body')),0) not between 1 and 5000 then raise exception using errcode='22023',message='Add a comment (up to 5000 characters).'; end if;
  d:=coalesce(payload->'mentions','[]');
  insert into public.hq_comments(org_id,id,kind,record_id,actor,body,mentions) values(w,(payload->>'commentId')::uuid,payload->>'kind',i,s,payload->>'body',d) on conflict do nothing;
  select * into comment from public.hq_comments where org_id=w and id=(payload->>'commentId')::uuid;
  if comment.actor<>s or comment.kind<>payload->>'kind' or comment.record_id<>i or comment.body<>payload->>'body' or comment.mentions is distinct from d then raise exception using errcode='22023',message='Comment retry must match its original contents.'; end if;
  return '{}'::jsonb;
 end if;
 if act='reschedule' then
  select data into old from public.marketing_records where workspace_id=w and kind='deliverable' and id=i;
  if old is null then raise exception using errcode='22023',message='Deliverable was not found.'; end if;
  select data into p from public.marketing_records where workspace_id=w and kind='project' and id=old->>'projectId';
  if not private.hq_can_work(old,p,s) then raise exception using errcode='42501',message='Only assigned people or project members can change this date.'; end if;
  if coalesce(payload->>'version','') !~ '^\d{1,8}$' or payload->'version' is distinct from old->'version' then raise exception using errcode='40001',message='Someone changed this record. Reload before rescheduling.'; end if;
  if coalesce(payload->>'field','') not in ('productionDue','publishAt') or jsonb_typeof(payload->'time') is distinct from 'string' or (payload->>'field'='publishAt' and old->'publishing' is distinct from 'true'::jsonb) then raise exception using errcode='22023',message='Choose a production deadline or intended publication time.'; end if;
  if payload->>'time'<>'' then perform private.consignment_time(payload->>'time'); end if;
  if p->>'status' in ('completed','archived') or old->>'status'='done' or exists(select 1 from jsonb_each(old->'publications') where value->>'status' in ('scheduled','published')) then raise exception using errcode='22023',message='Confirmed or completed work is locked. Cancel actual scheduling first; published history stays unchanged.'; end if;
  if old->>(payload->>'field')=payload->>'time' then return jsonb_build_object('id',i,'data',old); end if;
  d:=jsonb_set(old,array[payload->>'field'],payload->'time')||jsonb_build_object('approval',null,'submission',null,'contentVersion',coalesce((old->>'contentVersion')::int,0)+1,'status',case when old->>'status' in ('ready','needs_review') then 'in_progress' else old->>'status' end,'version',(old->>'version')::int+1,'updatedAt',now());
  return private.hq_put(w,'deliverable',i,d,'calendar date changed: '||(payload->>'field'));
 end if;
 if act in ('spend','spend-reverse','spend-list') then
  select data into p from public.marketing_records where workspace_id=w and kind='project' and id=payload->>'projectId';
  if p is null then raise exception using errcode='22023',message='Project was not found.'; end if;
  if act='spend-list' then
   if coalesce(payload->>'offset','0') !~ '^\d{1,8}$' then raise exception using errcode='22023',message='Choose a valid spending page.'; end if;
   offset_n:=coalesce((payload->>'offset')::int,0);
   select jsonb_build_object('advertisingCents',coalesce(sum(amount_cents) filter(where category='advertising'),0),'creativeCents',coalesce(sum(amount_cents) filter(where category='creative'),0),'totalCents',coalesce(sum(amount_cents),0)) into total from public.hq_spend where org_id=w and project_id=payload->>'projectId';
   return jsonb_build_object('summary',total,'entries',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select e.*,exists(select 1 from public.hq_spend reversal where reversal.org_id=w and reversal.reverses=e.id) as reversed from public.hq_spend e where e.org_id=w and e.project_id=payload->>'projectId' order by e.created_at desc,e.id limit 50 offset offset_n) x),'nextOffset',case when (select count(*) from public.hq_spend where org_id=w and project_id=payload->>'projectId')>offset_n+50 then offset_n+50 else null end);
  end if;
  if p->>'owner' is distinct from s and not private.hq_capability(w,s,'budget_approve') then raise exception using errcode='42501',message='Only the project owner or a budget approver can record actual spending.'; end if;
  if coalesce(length(btrim(payload->>'note')),0) not between 1 and 2000 then raise exception using errcode='22023',message='Add a spending note or correction reason.'; end if;
  entry.org_id:=w;entry.id:=i::uuid;entry.project_id:=payload->>'projectId';entry.note:=payload->>'note';entry.actor:=s;entry.created_at:=now();
  if act='spend' then
   if coalesce(payload->>'category','') not in ('advertising','creative') or jsonb_typeof(payload->'amountCents') is distinct from 'number' or payload->>'amountCents' !~ '^\d{1,12}$' or (payload->>'amountCents')::bigint<=0 or coalesce(payload->>'spentOn','') !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(payload->'channel') is distinct from 'string' or length(payload->>'channel')>80 then raise exception using errcode='22023',message='Choose a cost category, positive amount, date and optional channel.'; end if;
   entry.category:=payload->>'category';entry.amount_cents:=(payload->>'amountCents')::bigint;entry.channel:=payload->>'channel';entry.spent_on:=(payload->>'spentOn')::date;
   if entry.spent_on>(now() at time zone 'America/Chicago')::date then raise exception using errcode='22023',message='Actual spending cannot be dated in the future.'; end if;
  else
   select * into existing from public.hq_spend where org_id=w and project_id=entry.project_id and id=(payload->>'reverses')::uuid and reverses is null;
   if existing.id is null then raise exception using errcode='22023',message='Choose an original spending entry in this project.'; end if;
   entry.category:=existing.category;entry.amount_cents:=-existing.amount_cents;entry.channel:=existing.channel;entry.spent_on:=existing.spent_on;entry.reverses:=existing.id;
  end if;
  select * into existing from public.hq_spend where org_id=w and id=entry.id;
  if existing.id is not null then
   if (to_jsonb(existing)-'created_at') is distinct from (to_jsonb(entry)-'created_at') then raise exception using errcode='22023',message='Spending retry must match the original entry.'; end if;
   return to_jsonb(existing);
  end if;
  if entry.reverses is not null and exists(select 1 from public.hq_spend where org_id=w and reverses=entry.reverses) then raise exception using errcode='22023',message='This spending entry has already been reversed.'; end if;
  insert into public.hq_spend select entry.*;
  perform private.hq_log(w,'project',entry.project_id,to_jsonb(entry),'actual spend '||case when entry.reverses is null then 'recorded' else 'reversed' end);
  return to_jsonb(entry);
 end if;
 raise exception using errcode='22023',message='Unknown operations action.';
end $$;
create or replace function public.hub_hq_operations(p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.hq_operations(p_action,p_payload)$$;
revoke all on function private.hq_notify(text,text,text,text,text,text,text,jsonb),private.hq_record_notifications(),private.hq_mention_notifications(),private.hq_reminders(text,text,timestamptz),private.hq_operations(text,jsonb),public.hub_hq_operations(text,jsonb) from public,anon,authenticated;
grant execute on function private.hq_operations(text,jsonb),public.hub_hq_operations(text,jsonb) to authenticated;
commit;
