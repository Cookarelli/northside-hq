begin;

alter table public.radar_sources
 add column cadence_minutes integer not null default 1440 check(cadence_minutes between 60 and 10080),
 add column allow_page boolean not null default false,
 add column permission_note text not null default '' check(length(permission_note)<=1000);

-- Extend Radar at its existing command boundary. Keep its records, leases and history.
alter function private.radar(text,jsonb) rename to radar_before_intelligence;
revoke all on function private.radar_before_intelligence(text,jsonb) from public,anon,authenticated,service_role;
create function private.radar(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); d jsonb:=p_data->'data'; result jsonb; src public.radar_sources;
begin
 if p_action='edit-source' then
  select * into strict src from public.radar_sources where org_id=w and id=p_data->>'id' for update;
  if coalesce((d->>'allowPage')::boolean,false) and length(btrim(coalesce(d->>'permissionNote','')))<10 then raise invalid_parameter_value using message='Publisher permission is required.'; end if;
  if coalesce(d->>'feedUrl','')<>'' and (d->>'feedUrl' !~ '^https://' or length(d->>'feedUrl')>2048 or d->>'feedUrl' ~ '@') then raise invalid_parameter_value; end if;
  result:=private.radar_before_intelligence(p_action,p_data);
  update public.radar_sources set cadence_minutes=coalesce((d->>'cadenceMinutes')::integer,cadence_minutes),allow_page=coalesce((d->>'allowPage')::boolean,false),permission_note=coalesce(d->>'permissionNote',''),
   feed_url=case when d ? 'feedUrl' then nullif(d->>'feedUrl','') else feed_url end,etag=null,modified=null,cursor=null,
   method=case when d ? 'feedUrl' and nullif(d->>'feedUrl','') is distinct from src.feed_url then d->>'mode' else method end,
   last_success=case when d->>'url' is distinct from src.url or d ? 'feedUrl' and nullif(d->>'feedUrl','') is distinct from src.feed_url then null else last_success end,
   next_attempt=case when last_attempt is null then null else to_char((now()+interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
  where org_id=w and id=src.id;
  return result;
 end if;
 if p_action='acquire-source' and p_data->>'id' is null then
  select * into src from public.radar_sources where org_id=w and enabled=1 and method<>'manual'
   and (next_attempt is null or next_attempt::timestamptz<=now()) and (lock_until is null or lock_until::timestamptz<now())
   order by case priority when 'urgent' then 0 when 'high' then 1 else 2 end,last_attempt nulls first,id limit 1 for update skip locked;
  if not found then return 'null'::jsonb; end if;
  p_data:=p_data||jsonb_build_object('id',src.id);
 end if;
 result:=private.radar_before_intelligence(p_action,p_data);
 if p_action='finish-source' and coalesce((result->>'stale')::boolean,false)=false and d->>'status' in ('success','unchanged') and coalesce(d->>'cursor','')='' then
  update public.radar_sources set next_attempt=to_char((now()+make_interval(mins=>cadence_minutes)) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where org_id=w and id=p_data->>'sourceId';
 end if;
 return result;
end $$;
create or replace function public.hub_radar(p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.radar(p_action,p_data) $$;
revoke all on function private.radar(text,jsonb) from public,anon,service_role;
grant execute on function private.radar(text,jsonb) to authenticated;

create table public.intelligence_reports (
 org_id text not null references public.radar_organizations(id), id uuid not null,
 kind text not null check(kind in ('briefing','daily','weekly')), report_day date not null,
 data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=200000),
 created_at timestamptz not null default now(), created_by uuid not null,
 primary key(org_id,id)
);
create index intelligence_reports_recent on public.intelligence_reports(org_id,kind,created_at desc);
create view public.intelligence_posts with (security_invoker=true) as select org_id,page_id,platform,account_id,external_id,left(caption,500) caption,url,published_at,media_type,state from public.meta_imports;
revoke all on public.intelligence_posts from public,anon,authenticated,service_role;
grant select on public.intelligence_posts to authenticated;
create table public.intelligence_campaign_links (
 org_id text not null references public.radar_organizations(id), campaign_kind text not null check(campaign_kind in ('project','campaign')), campaign_id text not null,
 reporting_key text check(length(reporting_key) between 1 and 180), version integer not null default 1, updated_by uuid not null,
 primary key(org_id,campaign_kind,campaign_id),unique(org_id,reporting_key)
);
create table public.intelligence_labels (
 org_id text not null, page_id text not null, platform text not null, external_id text not null,
 category text not null check(category in ('Sports','New releases','Chase cards','Consignment','Auctions','Pokemon','Entertainment cards','Store promotions','Unclassified')),
 template text check(template in ('community-source','collector-question')),
 campaign_id text, campaign_kind text check(campaign_kind in ('project','campaign')),
 version integer not null default 1, updated_at timestamptz not null default now(), updated_by uuid not null,
 primary key(org_id,page_id,platform,external_id),
 foreign key(org_id,page_id) references public.meta_connections(org_id,page_id),
 check(platform in ('facebook','instagram')),check((campaign_id is null)=(campaign_kind is null))
);
create table public.meta_analytics_snapshots (
 org_id text not null, id uuid not null default gen_random_uuid(), page_id text not null,
 platform text not null check(platform in ('facebook','instagram')), subject_id text not null,
 kind text not null check(kind in ('post','account')), observed_at timestamptz not null default now(),
 metrics jsonb not null check(jsonb_typeof(metrics)='object'), unavailable text[] not null default '{}',
 format text not null default 'normalized' check(format in ('normalized','meta')),
 primary key(org_id,id), unique(org_id,page_id,platform,subject_id,kind,observed_at),
 foreign key(org_id,page_id) references public.meta_connections(org_id,page_id)
);
create index meta_analytics_latest on public.meta_analytics_snapshots(org_id,page_id,platform,subject_id,observed_at desc);
create index meta_analytics_recent on public.meta_analytics_snapshots(org_id,observed_at desc);
create table public.intelligence_sync_runs (
 org_id text not null, id uuid not null default gen_random_uuid(), page_id text not null,
 platform text not null, mode text not null, status text not null default 'running' check(status in ('running','success','error','interrupted')),
 started_at timestamptz not null default now(), finished_at timestamptz, records integer not null default 0,
 error_code text, primary key(org_id,id), foreign key(org_id,page_id) references public.meta_connections(org_id,page_id)
);
create index intelligence_sync_recent on public.intelligence_sync_runs(org_id,started_at desc);
create table private.intelligence_sync_state (
 org_id text not null, page_id text not null, platform text not null, mode text not null check(mode in ('history','current','metrics')),
 cursor text, watermark timestamptz, sweep_started_at timestamptz, completed boolean not null default false,
 lease uuid, lease_until timestamptz, actor uuid, run_id uuid, retry_at timestamptz,
 primary key(org_id,page_id,platform,mode), foreign key(org_id,page_id) references public.meta_connections(org_id,page_id)
);
alter table private.intelligence_sync_state enable row level security;
revoke all on private.intelligence_sync_state from public,anon,authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['intelligence_reports','intelligence_labels','meta_analytics_snapshots','intelligence_sync_runs','intelligence_campaign_links'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy staff_read on public.%I for select to authenticated using(org_id=(select private.workspace()))',t);
 end loop;
end $$;

-- Preserve every future shared-adapter observation without changing its engine.
create function private.snapshot_meta_insights() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.meta_analytics_snapshots(org_id,page_id,platform,subject_id,kind,observed_at,metrics,unavailable,format)
 values(new.org_id,new.page_id,case new.kind when 'instagram' then 'instagram' else 'facebook' end,new.subject_id,case new.kind when 'page' then 'account' else 'post' end,new.observed_at,new.metrics,new.unavailable,'meta') on conflict do nothing;
 return new;
end $$;
revoke all on function private.snapshot_meta_insights() from public,anon,authenticated,service_role;
create trigger intelligence_snapshot after insert or update on public.meta_insights for each row execute function private.snapshot_meta_insights();
insert into public.meta_analytics_snapshots(org_id,page_id,platform,subject_id,kind,observed_at,metrics,unavailable,format)
select org_id,page_id,case kind when 'instagram' then 'instagram' else 'facebook' end,subject_id,case kind when 'page' then 'account' else 'post' end,observed_at,metrics,unavailable,'meta' from public.meta_insights on conflict do nothing;

create function private.intelligence(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); result jsonb; report public.intelligence_reports; idea jsonb; ident text; calendar_ident text; d jsonb; draft jsonb; prior integer;
begin
 if octet_length(p::text)>220000 then raise invalid_parameter_value; end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 case p_action
 when 'campaign-link' then
  if not exists(select 1 from public.marketing_records where workspace_id=w and kind=p->>'campaignKind' and id=p->>'campaignId' and kind in ('project','campaign')) then raise invalid_parameter_value; end if;
  if p->>'reportingKey' is not null and not exists(select 1 from public.marketing_records where workspace_id=w and kind='metrics' and data->>'campaign'=p->>'reportingKey') then raise invalid_parameter_value using message='Choose a saved reporting campaign.'; end if;
  select version into prior from public.intelligence_campaign_links where org_id=w and campaign_kind=p->>'campaignKind' and campaign_id=p->>'campaignId' for update;
  if coalesce(prior,0) is distinct from (p->>'version')::integer then raise serialization_failure using message='Campaign mapping changed.'; end if;
  insert into public.intelligence_campaign_links(org_id,campaign_kind,campaign_id,reporting_key,updated_by) values(w,p->>'campaignKind',p->>'campaignId',p->>'reportingKey',auth.uid())
  on conflict(org_id,campaign_kind,campaign_id) do update set reporting_key=excluded.reporting_key,version=intelligence_campaign_links.version+1,updated_by=excluded.updated_by;
 when 'report' then
  if jsonb_typeof(p->'data'->'ideas') is distinct from 'array' or jsonb_array_length(p->'data'->'ideas')>5 then raise invalid_parameter_value; end if;
  insert into public.intelligence_reports(org_id,id,kind,report_day,data,created_by) values(w,(p->>'id')::uuid,p->>'kind',(now() at time zone 'America/Chicago')::date,p->'data',auth.uid()) on conflict do nothing;
  return jsonb_build_object('id',p->>'id');
 when 'label' then
  if not exists(select 1 from public.meta_imports where org_id=w and page_id=p->>'pageId' and platform=p->>'platform' and external_id=p->>'externalId') then raise no_data_found; end if;
  if p->>'campaignId' is not null and not exists(select 1 from public.marketing_records where workspace_id=w and kind=p->>'campaignKind' and id=p->>'campaignId' and kind in ('project','campaign')) then raise invalid_parameter_value using message='Choose an existing campaign or project.'; end if;
  select version into prior from public.intelligence_labels where org_id=w and page_id=p->>'pageId' and platform=p->>'platform' and external_id=p->>'externalId' for update;
  if coalesce(prior,0) is distinct from (p->>'version')::integer then raise serialization_failure using message='Attribution changed. Reload before saving.'; end if;
  insert into public.intelligence_labels(org_id,page_id,platform,external_id,category,template,campaign_id,campaign_kind,updated_by)
  values(w,p->>'pageId',p->>'platform',p->>'externalId',p->>'category',p->>'template',p->>'campaignId',p->>'campaignKind',auth.uid())
  on conflict(org_id,page_id,platform,external_id) do update set category=excluded.category,template=excluded.template,campaign_id=excluded.campaign_id,campaign_kind=excluded.campaign_kind,version=intelligence_labels.version+1,updated_by=excluded.updated_by,updated_at=now();
 when 'handoff' then
  select * into strict report from public.intelligence_reports where org_id=w and id=(p->>'reportId')::uuid;
  select value into idea from jsonb_array_elements(report.data->'ideas') where value->>'id'=p->>'ideaId';
  if idea is null or coalesce(idea->>'sourceUrl','')!~'^https://' then raise invalid_parameter_value; end if;
  ident:='intel_'||substr(encode(sha256(convert_to(coalesce(idea->>'itemId',report.id::text||':'||(idea->>'id')),'UTF8')),'hex'),1,40);
  if idea->>'itemId' is not null then
   select coalesce((select id from public.radar_editorial where org_id=w and kind='queue' and data->>'itemId'=idea->>'itemId' order by updated_at limit 1),ident) into ident;
  end if;
  if idea->>'itemId' is not null and not exists(select 1 from public.radar_items where org_id=w and id=idea->>'itemId' and status<>'dismissed' and verification<>'disputed' and url=idea->>'sourceUrl' and title=idea->>'headline') then raise invalid_parameter_value using message='Source changed. Generate a fresh briefing.'; end if;
  if not exists(select 1 from public.radar_editorial where org_id=w and kind='queue' and id=ident) then
   d:=jsonb_build_object('itemId',coalesce(idea->>'itemId',''),'title',idea->>'headline','state','Needs review','assignee','','notes',concat(idea->>'whyToday',E'\nTemplate: ',idea->>'template',E'\n',idea->'checks'),
    'facebook',idea->>'facebook','instagram',idea->>'instagram','reel','Show an owned asset and verify every factual claim.','references',jsonb_build_array(idea->>'sourceUrl'),
    'cta','Talk cards with Northside.','original','none','assetId','','assetOwner','','attribution','','permission','unknown','permissionEvidence','','calendarDate',p->>'date','calendarChannel','facebook');
   perform private.editorial_save('queue',ident,0,d);
  end if;
  if (p->>'calendar')::boolean then
   -- A draft only, never an approved schedule or publication task; retry preserves human edits.
   if p->>'date' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then raise invalid_parameter_value; end if;
   select coalesce((select id from public.marketing_records where workspace_id=w and kind='post' and (id=ident or data->>'radarId'=ident or id='radar_'||ident) order by updated_at limit 1),ident) into calendar_ident;
   select data into draft from public.radar_editorial where org_id=w and kind='queue' and id=ident;
   d:=jsonb_build_object('title',draft->>'title','date',p->>'date','timezone','America/Chicago','source','facebook','platforms',jsonb_build_array('facebook','instagram'),
    'caption',draft->>'facebook','status','draft','category','Brand / educational','references',draft->'references','tasks',idea->'checks','intelligenceReport',report.id,'intelligenceIdea',idea->>'id');
   if exists(select 1 from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'legacyEditorialId'=ident) then calendar_ident:=null;
   else perform private.save_record('post',calendar_ident,d) where not exists(select 1 from public.marketing_records where workspace_id=w and kind='post' and id=calendar_ident); end if;
  end if;
  return jsonb_build_object('queueId',ident,'calendarId',calendar_ident);
 else raise invalid_parameter_value;
 end case;
 return jsonb_build_object('ok',true);
end $$;
create function public.hub_intelligence(p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.intelligence(p_action,p_payload) $$;
revoke all on function private.intelligence(text,jsonb),public.hub_intelligence(text,jsonb) from public,anon,service_role;
grant execute on function private.intelligence(text,jsonb),public.hub_intelligence(text,jsonb) to authenticated;

-- Independent, read-only manual sync. No shared tasks, worker activation or publishing effects.
create function private.intelligence_sync(p_actor uuid,p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text; old_sub text:=current_setting('request.jwt.claim.sub',true); c public.meta_connections; s private.intelligence_sync_state; result jsonb; token uuid; run uuid; account text; item jsonb; stamp timestamptz:=clock_timestamp();
begin
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 w:=private.require_staff();
 if private.staff_role() is distinct from 'admin' then raise insufficient_privilege; end if;
 if octet_length(p::text)>1000000 or coalesce(p->>'platform','') not in ('facebook','instagram') or coalesce(p->>'mode','') not in ('history','current','metrics') then raise invalid_parameter_value; end if;
 select * into strict c from public.meta_connections where org_id=w and page_id=p->>'pageId' and status<>'disconnected' for share;
 account:=case p->>'platform' when 'instagram' then c.instagram_id else c.page_id end;
 if account is null then raise invalid_parameter_value; end if;
 perform pg_advisory_xact_lock(hashtextextended(w||c.page_id||'intelligence',0));
 if p_action='claim' then
  insert into private.intelligence_sync_state(org_id,page_id,platform,mode) values(w,c.page_id,p->>'platform',p->>'mode') on conflict do nothing;
  select * into strict s from private.intelligence_sync_state where org_id=w and page_id=c.page_id and platform=p->>'platform' and mode=p->>'mode' for update;
  if s.lease_until>now() or s.retry_at>now() or s.mode='history' and s.completed then
   result:=jsonb_build_object('skipped',true,'complete',s.completed,'reason',case when s.mode='history' and s.completed then 'history_complete' else 'busy' end,'retryAt',s.retry_at);
  else
   if s.run_id is not null then update public.intelligence_sync_runs set status='interrupted',error_code='lease_expired',finished_at=now() where org_id=w and id=s.run_id and status='running'; end if;
   token:=gen_random_uuid();run:=gen_random_uuid();
   update private.intelligence_sync_state set lease=token,lease_until=now()+interval '2 minutes',actor=p_actor,run_id=run,sweep_started_at=coalesce(s.sweep_started_at,stamp) where org_id=w and page_id=c.page_id and platform=s.platform and mode=s.mode;
   insert into public.intelligence_sync_runs(org_id,id,page_id,platform,mode) values(w,run,c.page_id,s.platform,s.mode);
   select jsonb_build_object('token',token,'runId',run,'org',w,'account',account,'after',s.cursor,'watermark',s.watermark,'until',coalesce(s.sweep_started_at,stamp),'ciphertext',ciphertext) into result from private.meta_credentials where org_id=w and credential_id='page:'||c.page_id and (expires_at is null or expires_at>now());
   if result is null then raise insufficient_privilege using message='Reconnect Meta.'; end if;
   if s.mode='metrics' then
    result:=result||jsonb_build_object('posts',coalesce((select jsonb_agg(to_jsonb(rows)) from (select external_id from public.meta_imports where org_id=w and page_id=c.page_id and platform=s.platform and state='published' and external_id>coalesce(s.cursor,'') order by external_id limit 2) rows),'[]'::jsonb));
   end if;
  end if;
 elsif p_action='finish' then
  select * into strict s from private.intelligence_sync_state where org_id=w and page_id=c.page_id and platform=p->>'platform' and mode=p->>'mode' and lease=(p->>'token')::uuid and lease_until>now() and actor=p_actor for update;
  if p->>'error' is not null then
   if p->>'error' not in ('meta_reconnect_required','meta_permission_missing','meta_rate_limited','meta_field_unavailable','meta_request_failed','meta_transport_unavailable','meta_invalid_response','credential_unavailable') then raise invalid_parameter_value; end if;
   update public.intelligence_sync_runs set status='error',error_code=p->>'error',finished_at=stamp where org_id=w and id=s.run_id;
   update private.intelligence_sync_state set lease=null,lease_until=null,retry_at=now()+interval '15 minutes' where org_id=w and page_id=c.page_id and platform=s.platform and mode=s.mode;
  else
   if jsonb_array_length(coalesce(p->'posts','[]'))>25 or jsonb_array_length(coalesce(p->'snapshots','[]'))>1 or length(coalesce(p->>'after',''))>2000 then raise invalid_parameter_value; end if;
   for item in select value from jsonb_array_elements(coalesce(p->'posts','[]')) loop
    if s.mode='metrics' or coalesce(item->>'id','')!~'^\d+(_\d+)?$' or s.platform='facebook' and item->>'id' not like c.page_id||'\_%' escape '\' then raise invalid_parameter_value; end if;
    insert into public.meta_imports(org_id,page_id,platform,account_id,external_id,caption,content_hash,media_ids,media_type,state,url,published_at,verified_at)
    values(w,c.page_id,s.platform,account,item->>'id',left(item->>'caption',30000),private.meta_hash(item->>'caption'),array(select jsonb_array_elements_text(item->'mediaIds')),item->>'mediaType','published',item->>'url',(item->>'publishedAt')::timestamptz,(item->>'verifiedAt')::timestamptz)
    on conflict(org_id,platform,account_id,external_id) do update set caption=excluded.caption,content_hash=excluded.content_hash,media_type=excluded.media_type,media_ids=excluded.media_ids,url=excluded.url,published_at=excluded.published_at,verified_at=excluded.verified_at,synced_at=stamp
    where (meta_imports.caption,meta_imports.media_type,meta_imports.media_ids,meta_imports.url,meta_imports.published_at) is distinct from (excluded.caption,excluded.media_type,excluded.media_ids,excluded.url,excluded.published_at);
   end loop;
   for item in select value from jsonb_array_elements(coalesce(p->'snapshots','[]')) loop
    if s.mode<>'metrics' or not exists(select 1 from public.meta_imports where org_id=w and page_id=c.page_id and platform=s.platform and external_id=item->>'id' and state='published') then raise invalid_parameter_value; end if;
    insert into public.meta_analytics_snapshots(org_id,page_id,platform,subject_id,kind,observed_at,metrics,unavailable)
    values(w,c.page_id,s.platform,item->>'id','post',stamp,item->'metrics',array(select jsonb_array_elements_text(item->'unavailable')));
   end loop;
   update private.intelligence_sync_state set cursor=p->>'after',completed=(p->>'after' is null),watermark=case when p->>'after' is null then s.sweep_started_at else watermark end,sweep_started_at=case when p->>'after' is null then null else sweep_started_at end,lease=null,lease_until=null,retry_at=now()+interval '10 seconds' where org_id=w and page_id=c.page_id and platform=s.platform and mode=s.mode;
   update public.intelligence_sync_runs set status='success',finished_at=stamp,records=jsonb_array_length(coalesce(p->'posts','[]'))+jsonb_array_length(coalesce(p->'snapshots','[]')) where org_id=w and id=s.run_id;
  end if;
  result:=jsonb_build_object('ok',true,'complete',p->>'after' is null,'error',p->>'error');
 else raise invalid_parameter_value; end if;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 return result;
end $$;
create function public.hub_intelligence_sync(p_actor uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.intelligence_sync(p_actor,p_action,p_payload) $$;
revoke all on function private.intelligence_sync(uuid,text,jsonb),public.hub_intelligence_sync(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.intelligence_sync(uuid,text,jsonb),public.hub_intelligence_sync(uuid,text,jsonb) to service_role;
commit;
