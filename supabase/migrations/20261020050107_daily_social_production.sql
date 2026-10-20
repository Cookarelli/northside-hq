-- Additive, no backfill or activation. Existing HQ writers and approval rules are reused.
begin;
set local lock_timeout='2s';
create table public.hq_daily_content (
 org_id text not null, record_kind text not null default 'deliverable' check(record_kind='deliverable'),
 deliverable_id text not null, pillar text not null check(pillar in ('The New Northside','Northside Buys','Northside Sports Desk','Meet Northside','The Hobby Report','Northside Collects')),
 format text not null check(format in ('video','static','carousel')), original boolean not null,
 version integer not null default 1 check(version>0), stories jsonb not null default '{}' check(jsonb_typeof(stories)='object'),
 creation jsonb not null default '{}', created_by text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(org_id,deliverable_id),
 foreign key(org_id,record_kind,deliverable_id) references public.marketing_records(workspace_id,kind,id)
);
create table public.hq_daily_metrics (
 org_id text not null, id uuid not null, deliverable_id text not null, platform text not null check(platform in ('facebook','instagram','x','youtube','tiktok','snapchat')),
 surface text not null check(surface in ('feed','story')), observed_at timestamptz not null,
 period text not null check(period in ('lifetime','day')), period_date date,
 evidence_url text not null, values jsonb not null, actor text not null, created_at timestamptz not null default now(),
 primary key(org_id,id), foreign key(org_id,deliverable_id) references public.hq_daily_content(org_id,deliverable_id),
 check((period='day' and period_date is not null) or (period='lifetime' and period_date is null))
);
create index hq_daily_metrics_latest on public.hq_daily_metrics(org_id,deliverable_id,platform,surface,observed_at desc,created_at desc,id);
alter table public.hq_daily_content enable row level security;
alter table public.hq_daily_metrics enable row level security;
revoke all on public.hq_daily_content,public.hq_daily_metrics from public,anon,authenticated;
grant select on public.hq_daily_content,public.hq_daily_metrics to authenticated;
create policy staff_read on public.hq_daily_content for select to authenticated using(org_id=(select private.workspace()));
create policy staff_read on public.hq_daily_metrics for select to authenticated using(org_id=(select private.workspace()));

-- Existing HQ dates can be Chicago wall times or imported explicit instants.
create function private.daily_instant(value text) returns timestamptz
language plpgsql set search_path='' as $$
begin
 if value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then return value::timestamptz; end if;
 return private.consignment_time(value);
end $$;
revoke all on function private.daily_instant(text) from public,anon,authenticated;
create function private.daily_production(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); i text:=p_payload->>'id';
 d jsonb; p jsonb; result jsonb; entry jsonb; rows jsonb; snapshots jsonb; ids text[];
 meta public.hq_daily_content; metric public.hq_daily_metrics;
 dest text:=p_payload->>'platform'; next_status text:=p_payload->>'status'; t text; key text; v jsonb; day date; off integer;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in to use production tracking.'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>30000 then raise exception using errcode='22023',message='Check production fields and size.'; end if;
 -- The same workspace lock as every canonical writer makes classification and Story facts atomic with source changes.
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if p_action='list' then
  if p_payload-array['day','offset']<>'{}'::jsonb or coalesce(p_payload->>'day','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_payload->>'offset','') !~ '^\d{1,6}$' then raise exception using errcode='22023',message='Choose a date and valid page.'; end if;
  day:=(p_payload->>'day')::date;off:=(p_payload->>'offset')::int;
  select coalesce(array_agg(c.deliverable_id order by c.deliverable_id),array[]::text[]) into ids from (
   select c.deliverable_id from public.hq_daily_content c join public.marketing_records r on r.workspace_id=c.org_id and r.kind='deliverable' and r.id=c.deliverable_id
   where c.org_id=w and r.data->>'deletedAt' is null and coalesce(r.data->>'publishAt','')<>'' and (private.daily_instant(r.data->>'publishAt') at time zone 'America/Chicago')::date=day order by c.deliverable_id limit 50 offset off
  ) c;
  select coalesce(jsonb_agg(to_jsonb(c)-array['org_id','record_kind','creation'] order by c.deliverable_id),'[]') into rows from public.hq_daily_content c where c.org_id=w and c.deliverable_id=any(ids);
  select coalesce(jsonb_agg(to_jsonb(m)-'org_id'),'[]') into snapshots from (
   select distinct on(deliverable_id,platform,surface) * from public.hq_daily_metrics where org_id=w and deliverable_id=any(ids) order by deliverable_id,platform,surface,observed_at desc,created_at desc,id
  ) m;
  return jsonb_build_object('content',rows,'metrics',snapshots,'nextOffset',case when cardinality(ids)=50 then off+50 else null end);
 end if;
 if coalesce(i,'') !~ '^[a-zA-Z0-9_-]{1,180}$' or p_action is null or p_action not in ('create','classify','story','metrics') then raise exception using errcode='22023',message='Choose a production action and deliverable.'; end if;
 select * into meta from public.hq_daily_content where org_id=w and deliverable_id=i for update;
 if p_action in ('create','classify') then
  if coalesce(p_payload->>'pillar','') not in ('The New Northside','Northside Buys','Northside Sports Desk','Meet Northside','The Hobby Report','Northside Collects') or coalesce(p_payload->>'format','') not in ('video','static','carousel') or jsonb_typeof(p_payload->'original') is distinct from 'boolean' then raise exception using errcode='22023',message='Choose a pillar, format and originality.'; end if;
 end if;
 if p_action='create' then
  if p_payload-array['id','pillar','format','original','data']<>'{}'::jsonb then raise exception using errcode='22023',message='Check draft fields.'; end if;
  if meta.deliverable_id is not null then
   if meta.creation is distinct from p_payload then raise exception using errcode='40001',message='This draft request changed. Reload before creating another.'; end if;
   return jsonb_build_object('id',i,'existing',true);
  end if;
  if exists(select 1 from public.marketing_records where workspace_id=w and kind='deliverable' and id=i) then raise exception using errcode='40001',message='This deliverable already exists. Include it explicitly instead.'; end if;
  d:=p_payload->'data';
  if coalesce(d->>'owner','')='' or coalesce(d->>'approver','')='' or coalesce(d->>'publisher','')='' or coalesce(d->>'productionDue','')='' or coalesce(d->>'publishAt','')='' or d->'publishing' is distinct from 'true'::jsonb or d->>'projectId' is distinct from '' or d->>'format' is distinct from (case p_payload->>'format' when 'video' then 'Video' when 'static' then 'Static' else 'Carousel' end) then raise exception using errcode='22023',message='Choose assignments, format and dates for this draft.'; end if;
  if (private.daily_instant(d->>'publishAt') at time zone 'America/Chicago')::date<'2026-10-20'::date then raise exception using errcode='22023',message='New daily drafts begin October 20, 2026.'; end if;
  result:=private.hq('save-deliverable',jsonb_build_object('id',i,'version',0,'data',d));
  insert into public.hq_daily_content(org_id,deliverable_id,pillar,format,original,creation,created_by) values(w,i,p_payload->>'pillar',p_payload->>'format',(p_payload->>'original')::boolean,p_payload,s) returning * into meta;
 else
  select data into d from public.marketing_records where workspace_id=w and kind='deliverable' and id=i;
  if d is null or d->>'deletedAt' is not null or d->>'workflow'='task' or d->'publishing' is distinct from 'true'::jsonb then raise exception using errcode='22023',message='Choose an available publishing deliverable.'; end if;
  select data into p from public.marketing_records where workspace_id=w and kind='project' and id=d->>'projectId';
  if not private.hq_can_work(d,p,s) then raise exception using errcode='42501',message='Only assigned staff or administrators can track this content.'; end if;
  if p_action in ('classify','story') then
   if coalesce(p_payload->>'version','') !~ '^\d{1,8}$' or (p_payload->>'version')::integer<>coalesce(meta.version,0) or coalesce(p_payload->>'recordVersion','') !~ '^\d{1,8}$' or (p_payload->>'recordVersion')::integer<>(d->>'version')::integer then raise exception using errcode='40001',message='This work changed. Reload and review before saving.'; end if;
  end if;
  if p_action='classify' then
   if p_payload-array['id','version','recordVersion','pillar','format','original']<>'{}'::jsonb then raise exception using errcode='22023',message='Check classification fields.'; end if;
   if meta.deliverable_id is not null and (exists(select 1 from jsonb_each(d->'publications') where value->>'status' in ('scheduled','published')) or exists(select 1 from jsonb_each(meta.stories) where value->>'status' in ('scheduled','published'))) then raise exception using errcode='22023',message='Confirmed content classification is retained. Create follow-up work for changes.'; end if;
   insert into public.hq_daily_content(org_id,deliverable_id,pillar,format,original,created_by) values(w,i,p_payload->>'pillar',p_payload->>'format',(p_payload->>'original')::boolean,s)
   on conflict(org_id,deliverable_id) do update set pillar=excluded.pillar,format=excluded.format,original=excluded.original,version=hq_daily_content.version+1,updated_at=now() returning * into meta;
  elsif p_action='story' then
   if meta.deliverable_id is null or not meta.original then raise exception using errcode='22023',message='Include the original before tracking its Story reposts.'; end if;
   if p_payload-array['id','version','recordVersion','platform','status','time','url','unavailableReason','confirmed']<>'{}'::jsonb or p_payload->'confirmed' is distinct from 'true'::jsonb or coalesce(dest,'') not in ('facebook','instagram') or coalesce(next_status,'') not in ('planned','scheduled','published') then raise exception using errcode='22023',message='Confirm the Story destination and status.'; end if;
   if not coalesce(d->>'publisher'=s or private.hq_approver(d,p)=s or private.staff_role()='admin',false) then raise exception using errcode='42501',message='Only the publisher, approver or administrator can confirm a Story repost.'; end if;
   if meta.stories->dest->>'status'='published' then raise exception using errcode='22023',message='Published Story facts are permanent; add a correction in activity comments.'; end if;
   if next_status<>'planned' and d->'publications'->dest->>'status' is distinct from 'published' then raise exception using errcode='22023',message='Confirm the published original on this platform before its Story repost.'; end if;
   if length(coalesce(p_payload->>'url',''))>2000 or length(coalesce(p_payload->>'unavailableReason',''))>1000 or (coalesce(p_payload->>'url','')<>'' and p_payload->>'url' !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$') then raise exception using errcode='22023',message='Use a valid Story HTTPS URL or explain why it is unavailable.'; end if;
   t:=case when next_status='planned' then '' else private.hq_time(p_payload->>'time') end;
   if next_status<>'planned' and coalesce(t,'')='' then raise exception using errcode='22023',message='Add the actual Story time.'; end if;
   if next_status='published' and (private.daily_instant(t)>now() or private.daily_instant(t)<private.daily_instant(d->'publications'->dest->>'publishedAt') or (coalesce(p_payload->>'url','')='' and length(btrim(coalesce(p_payload->>'unavailableReason','')))=0)) then raise exception using errcode='22023',message='Record a past Story time after the original, with its URL or unavailable-link reason.'; end if;
   if next_status='scheduled' and private.daily_instant(t)<=now() then raise exception using errcode='22023',message='A confirmed Story schedule needs a future time.'; end if;
   entry:=jsonb_build_object('status',next_status,'time',t,'url',coalesce(p_payload->>'url',''),'unavailableReason',coalesce(p_payload->>'unavailableReason',''),'by',s,'recordedAt',now());
   update public.hq_daily_content set stories=jsonb_set(stories,array[dest],entry),version=version+1,updated_at=now() where org_id=w and deliverable_id=i returning * into meta;
  elsif p_action='metrics' then
   if meta.deliverable_id is null or p_payload-array['id','requestId','platform','surface','observedAt','period','periodDate','evidenceUrl','values']<>'{}'::jsonb or coalesce(dest,'') not in ('facebook','instagram','x','youtube','tiktok','snapchat') or coalesce(p_payload->>'surface','') not in ('feed','story') or coalesce(p_payload->>'period','') not in ('lifetime','day') then raise exception using errcode='22023',message='Choose tracked content, platform, surface and reporting period.'; end if;
   if coalesce(p_payload->>'requestId','') !~ '^[a-fA-F0-9-]{36}$' then raise exception using errcode='22023',message='Choose a metric request ID.'; end if;
   t:=private.hq_time(p_payload->>'observedAt');
   if coalesce(t,'')='' or private.daily_instant(t)>now() or coalesce(p_payload->>'evidenceUrl','') !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' or length(p_payload->>'evidenceUrl')>2000 then raise exception using errcode='22023',message='Add a past observation time and HTTPS evidence URL.'; end if;
   if jsonb_typeof(p_payload->'values') is distinct from 'object' or (p_payload->'values')-array['views','reach','likes','comments','shares','saves','clicks']<>'{}'::jsonb or not ((p_payload->'values') ?& array['views','reach','likes','comments','shares','saves','clicks']) then raise exception using errcode='22023',message='Check metric names; leave unavailable values null.'; end if;
   for key,v in select * from jsonb_each(p_payload->'values') loop
    if v<>'null'::jsonb and (jsonb_typeof(v)<>'number' or v::text !~ '^\d{1,12}$') then raise exception using errcode='22023',message='Use nonnegative whole metric values or null.'; end if;
   end loop;
   if not exists(select 1 from jsonb_each(p_payload->'values') where value<>'null'::jsonb) then raise exception using errcode='22023',message='Enter at least one observed metric.'; end if;
   day:=null;
   if p_payload->>'period'='day' then
    if coalesce(p_payload->>'periodDate','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='Choose the metric reporting date.'; end if;
    day:=(p_payload->>'periodDate')::date;
    if day>(private.daily_instant(t) at time zone 'America/Chicago')::date then raise exception using errcode='22023',message='Reporting date cannot follow observation.'; end if;
   elsif coalesce(p_payload->>'periodDate','')<>'' then raise exception using errcode='22023',message='Lifetime snapshots have no daily reporting date.'; end if;
   select * into metric from public.hq_daily_metrics where org_id=w and id=(p_payload->>'requestId')::uuid;
   if metric.id is not null then
    if metric.deliverable_id is distinct from i or metric.platform is distinct from dest or metric.surface is distinct from p_payload->>'surface' or metric.observed_at is distinct from private.daily_instant(t) or metric.period is distinct from p_payload->>'period' or metric.period_date is distinct from day or metric.evidence_url is distinct from p_payload->>'evidenceUrl' or metric.values is distinct from p_payload->'values' then raise exception using errcode='40001',message='This metric request already records a different observation.'; end if;
    return jsonb_build_object('id',metric.id,'existing',true);
   end if;
   entry:=case when p_payload->>'surface'='story' then meta.stories->dest else d->'publications'->dest end;
   if entry->>'status' is distinct from 'published' then raise exception using errcode='22023',message='Confirm publication before recording its metrics.'; end if;
   if private.daily_instant(t)<private.daily_instant(coalesce(entry->>'publishedAt',entry->>'time')) then raise exception using errcode='22023',message='Observation must follow publication.'; end if;
   insert into public.hq_daily_metrics(org_id,id,deliverable_id,platform,surface,observed_at,period,period_date,evidence_url,values,actor) values(w,(p_payload->>'requestId')::uuid,i,dest,p_payload->>'surface',private.daily_instant(t),p_payload->>'period',day,p_payload->>'evidenceUrl',p_payload->'values',s);
  end if;
 end if;
 select data into d from public.marketing_records where workspace_id=w and kind='deliverable' and id=i;
 perform private.hq_log(w,'deliverable',i,d||jsonb_build_object('dailyProduction',to_jsonb(meta)-'creation','dailyObservation',case when p_action='metrics' then p_payload else null end),'daily-'||p_action);
 return jsonb_build_object('id',i);
end $$;
create function public.hub_daily_production(p_action text,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.daily_production(p_action,p_payload)$$;
revoke all on function private.daily_production(text,jsonb),public.hub_daily_production(text,jsonb) from public,anon,authenticated;
grant execute on function private.daily_production(text,jsonb),public.hub_daily_production(text,jsonb) to authenticated;
commit;
