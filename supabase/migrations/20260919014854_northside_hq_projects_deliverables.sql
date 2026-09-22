begin;
-- Additive and repeatable. Existing records are never backfilled or deleted.
create table if not exists private.hq_permissions (
 org_id text not null, staff_id text not null, capability text not null check(capability='budget_approve'),
 enabled boolean not null default true, primary key(org_id,staff_id,capability),
 foreign key(org_id,staff_id) references private.staff_access(org_id,id)
);
alter table private.hq_permissions enable row level security;
revoke all on private.hq_permissions from public,anon,authenticated;
-- Stable roster IDs are provisioning defaults only. Runtime authorization reads this table.
insert into private.hq_permissions(org_id,staff_id,capability)
 select org_id,id,'budget_approve' from private.staff_access
 where org_id='northside-marketing' and id in ('steve','joey')
 on conflict do nothing;

create table if not exists public.hq_activity (
 org_id text not null, id uuid not null default gen_random_uuid(), kind text not null,
 record_id text not null, project_id text, actor text not null, action text not null,
 snapshot jsonb not null, created_at timestamptz not null default now(), primary key(org_id,id)
);
create index if not exists hq_activity_record on public.hq_activity(org_id,kind,record_id,created_at desc,id);
create index if not exists hq_activity_project on public.hq_activity(org_id,project_id,created_at desc,id);
create table if not exists public.hq_comments (
 org_id text not null, id uuid not null, kind text not null check(kind in ('project','deliverable')),
 record_id text not null, actor text not null, body text not null check(length(btrim(body)) between 1 and 5000),
 created_at timestamptz not null default now(), primary key(org_id,id)
);
create index if not exists hq_comments_record on public.hq_comments(org_id,kind,record_id,created_at,id);
alter table public.hq_activity enable row level security;
alter table public.hq_comments enable row level security;
revoke all on public.hq_activity,public.hq_comments from public,anon,authenticated;
grant select on public.hq_activity,public.hq_comments to authenticated;
drop policy if exists staff_read on public.hq_activity;
create policy staff_read on public.hq_activity for select to authenticated using(org_id=(select private.workspace()));
drop policy if exists staff_read on public.hq_comments;
create policy staff_read on public.hq_comments for select to authenticated using(org_id=(select private.workspace()));
create unique index if not exists hq_legacy_campaign on public.marketing_records(workspace_id,(data->>'legacyCampaignId')) where kind='project' and data->>'legacyCampaignId' is not null;
create unique index if not exists hq_legacy_post on public.marketing_records(workspace_id,(data->>'legacyPostId')) where kind='deliverable' and data->>'legacyPostId' is not null;
create index if not exists hq_project_deliverables on public.marketing_records(workspace_id,(data->>'projectId'),id) where kind='deliverable';

create or replace function private.hq_staff_id() returns text language sql stable security definer set search_path='' as $$
 select a.id from private.staff_access a join auth.users u on lower(u.email)=a.email
 where u.id=(select auth.uid()) and u.email_confirmed_at is not null and a.active
$$;
create or replace function private.hq_active(w text,s text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.staff_access where org_id=w and id=s and active)
$$;
create or replace function private.hq_time(wall text) returns text language plpgsql set search_path='' as $$
begin perform private.consignment_time(wall); return wall; exception when others then return ''; end $$;

-- Every mutation shares the legacy workspace lock, including adoption and budget allocation.
create or replace function private.hq_log(w text,k text,i text,d jsonb,act text) returns void language sql set search_path='' as $$
 insert into public.hq_activity(org_id,kind,record_id,project_id,actor,action,snapshot)
 values(w,k,i,case when k='project' then i else nullif(d->>'projectId','') end,private.hq_staff_id(),act,d)
$$;
create or replace function private.hq_put(w text,k text,i text,d jsonb,act text) returns jsonb language plpgsql set search_path='' as $$
begin
 insert into public.marketing_records(workspace_id,kind,id,data) values(w,k,i,d)
 on conflict(workspace_id,kind,id) do update set data=excluded.data,updated_at=now();
 perform private.hq_log(w,k,i,d,act);
 return jsonb_build_object('id',i,'kind',k,'data',d);
end $$;

create or replace function private.hq_common(w text,d jsonb) returns void language plpgsql set search_path='' as $$
declare key text; item jsonb;
begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>100000 then raise exception using errcode='22023',message='Check record size and fields.'; end if;
 if jsonb_typeof(d->'title') is distinct from 'string' or length(btrim(d->>'title')) not between 1 and 300 then raise exception using errcode='22023',message='Add a title (up to 300 characters).'; end if;
 if jsonb_typeof(d->'owner') is distinct from 'string' or (d->>'owner'<>'' and not private.hq_active(w,d->>'owner')) then raise exception using errcode='22023',message='Choose an active owner in this organization.'; end if;
 foreach key in array array['assets','references'] loop
  if jsonb_typeof(d->key) is distinct from 'array' or jsonb_array_length(d->key)>60 then raise exception using errcode='22023',message='Use at most 60 assets or links.'; end if;
  for item in select value from jsonb_array_elements(d->key) loop
   if jsonb_typeof(item)<>'string' or length(item#>>'{}')>2000 then raise exception using errcode='22023',message='Check asset and reference values.'; end if;
   if key='references' and (item#>>'{}') !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' then raise exception using errcode='22023',message='Reference links must use HTTPS without credentials.'; end if;
   if key='assets' and not exists(select 1 from public.marketing_records where workspace_id=w and kind='asset' and id=item#>>'{}') then raise exception using errcode='22023',message='Select a saved asset from this organization.'; end if;
  end loop;
 end loop;
end $$;

create or replace function private.hq_validate(w text,k text,d jsonb) returns void language plpgsql set search_path='' as $$
declare key text; item jsonb; total bigint; keys text[]; verification jsonb; facts jsonb;
begin
 perform private.hq_common(w,d);
 if k='project' then
  keys:=array['title','type','brief','owner','members','status','eventAt','auctionOpensAt','auctionClosesAt','assets','references','allocations','auction'];
  if d->>'type' is null or d->>'type' not in ('weekly_auction','event','product_release','general') or d->>'status' is null or d->>'status' not in ('draft','active','completed','archived') then raise exception using errcode='22023',message='Choose a project type and status.'; end if;
  if jsonb_typeof(d->'brief') is distinct from 'string' or length(d->>'brief')>12000 then raise exception using errcode='22023',message='Check the project brief.'; end if;
  if d->>'status'<>'draft' and (d->>'owner'='' or length(btrim(d->>'brief'))=0 or (d->>'type' in ('event','product_release') and d->>'eventAt'='') or (d->>'type'='weekly_auction' and (d->>'auctionOpensAt'='' or d->>'auctionClosesAt'=''))) then raise exception using errcode='22023',message='Add the owner, brief and relevant dates before activating this project.'; end if;
  foreach key in array array['eventAt','auctionOpensAt','auctionClosesAt'] loop
   if jsonb_typeof(d->key) is distinct from 'string' then raise exception using errcode='22023',message='Check project dates.'; end if;
   if d->>key<>'' then perform private.consignment_time(d->>key); end if;
  end loop;
  if d->>'auctionOpensAt'<>'' and d->>'auctionClosesAt'<>'' and d->>'auctionOpensAt'>=d->>'auctionClosesAt' then raise exception using errcode='22023',message='Auction closing must follow opening.'; end if;
  if jsonb_typeof(d->'allocations') is distinct from 'array' or jsonb_array_length(d->'allocations')>30 then raise exception using errcode='22023',message='Check channel allocations.'; end if;
  for item in select value from jsonb_array_elements(d->'allocations') loop
   if jsonb_typeof(item->'channel') is distinct from 'string' or length(btrim(item->>'channel')) not between 1 and 80 or jsonb_typeof(item->'amountCents') is distinct from 'number' or (item->>'amountCents') !~ '^\d{1,12}$' then raise exception using errcode='22023',message='Each channel needs a name and a nonnegative whole number of cents.'; end if;
  end loop;
  if (select count(distinct lower(btrim(value->>'channel'))) from jsonb_array_elements(d->'allocations'))<>jsonb_array_length(d->'allocations') then raise exception using errcode='22023',message='List each budget channel once.'; end if;
  if d->'auction' is distinct from 'null'::jsonb then
   if jsonb_typeof(d->'auction') is distinct from 'object' or jsonb_typeof(d->'auction'->'auctionPlatform') is distinct from 'string' or jsonb_typeof(d->'auction'->'cards') is distinct from 'array' or jsonb_array_length(d->'auction'->'cards') not between 1 and 50 or coalesce(d->'auction'->>'batchUrl','') !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' then raise exception using errcode='22023',message='Auction facts need a batch link and featured lots.'; end if;
   for item in select value from jsonb_array_elements(d->'auction'->'cards') loop
    if jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 500 or coalesce(item->>'url','') !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' then raise exception using errcode='22023',message='Each featured lot needs a name and HTTPS link.'; end if;
   end loop;
  end if;
  key:='members';
 else
  keys:=array['title','instructions','owner','contributors','projectId','approver','productionDue','publishAt','format','platforms','caption','destinationUrl','effort','estimatedHours','publishing','blocked','blockedReason','blockedBy','assets','references','evidence'];
  foreach key in array array['instructions','projectId','approver','format','caption','destinationUrl','blockedReason','blockedBy','productionDue','publishAt'] loop
   if jsonb_typeof(d->key) is distinct from 'string' or length(d->>key)>12000 then raise exception using errcode='22023',message='Check deliverable text fields.'; end if;
  end loop;
  if d->>'owner'='' then raise exception using errcode='22023',message='Choose one accountable owner.'; end if;
  if d->>'projectId'='' and not private.hq_active(w,d->>'approver') then raise exception using errcode='22023',message='Standalone work needs an active designated approver.'; end if;
  if jsonb_typeof(d->'publishing') is distinct from 'boolean' or jsonb_typeof(d->'blocked') is distinct from 'boolean' or coalesce(d->>'effort','') not in ('quick','standard','premium') then raise exception using errcode='22023',message='Choose publishing, effort and blocked settings.'; end if;
  if d->'blocked'='true'::jsonb and (length(btrim(d->>'blockedReason'))=0 or not private.hq_active(w,d->>'blockedBy')) then raise exception using errcode='22023',message='Blocked work needs a reason and an active person to resolve it.'; end if;
  if d->'estimatedHours' is distinct from 'null'::jsonb and (jsonb_typeof(d->'estimatedHours') is distinct from 'number' or (d->>'estimatedHours')::numeric not between 0 and 10000) then raise exception using errcode='22023',message='Estimated hours must be between 0 and 10000.'; end if;
  foreach key in array array['productionDue','publishAt'] loop
   if d->>key<>'' then perform private.consignment_time(d->>key); end if;
  end loop;
  if d->>'destinationUrl'<>'' and d->>'destinationUrl' !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' then raise exception using errcode='22023',message='Use an HTTPS destination link without credentials.'; end if;
  if jsonb_typeof(d->'platforms') is distinct from 'array' or jsonb_array_length(d->'platforms')>8 or exists(select 1 from jsonb_array_elements_text(d->'platforms') where value not in ('facebook','instagram','x','youtube','tiktok','snapchat','email','website')) or (select count(distinct value) from jsonb_array_elements_text(d->'platforms'))<>jsonb_array_length(d->'platforms') then raise exception using errcode='22023',message='Choose distinct supported destinations.'; end if;
  if (d->'publishing'='true'::jsonb and jsonb_array_length(d->'platforms')=0) or (d->'publishing'='false'::jsonb and jsonb_array_length(d->'platforms')>0) then raise exception using errcode='22023',message='Publishing work needs destinations; nonpublishing work has none.'; end if;
  if jsonb_typeof(d->'evidence') is distinct from 'object' or (d->'evidence') - array['completedTasks','staffPicks','verification'] <> '{}'::jsonb then raise exception using errcode='22023',message='Check production evidence.'; end if;
  if d->'evidence' ? 'completedTasks' then
   if jsonb_typeof(d->'evidence'->'completedTasks') is distinct from 'array' or jsonb_array_length(d->'evidence'->'completedTasks')>50 then raise exception using errcode='22023',message='Completed production tasks must be a list.'; end if;
   if exists(select 1 from jsonb_array_elements(d->'evidence'->'completedTasks') where jsonb_typeof(value)<>'string' or length(value#>>'{}')>2000) then raise exception using errcode='22023',message='Check completed production tasks.'; end if;
  end if;
  if (d->'evidence' ? 'staffPicks' and jsonb_typeof(d->'evidence'->'staffPicks') is distinct from 'string') or (d->'evidence' ? 'verification' and jsonb_typeof(d->'evidence'->'verification') is distinct from 'object') then raise exception using errcode='22023',message='Check production verification fields.'; end if;
  verification:=d->'evidence'->'verification';
  foreach key in array array['lotLinksChecked','resultsChecked'] loop
   if verification ? key and jsonb_typeof(verification->key) is distinct from 'boolean' then raise exception using errcode='22023',message='Verification confirmations must be true or false.'; end if;
  end loop;
  if verification ? 'closing' then perform private.consignment_time(verification->>'closing'); end if;
  if verification ? 'reviewedCaption' and jsonb_typeof(verification->'reviewedCaption') is distinct from 'string' then raise exception using errcode='22023',message='Check the reviewed caption.'; end if;
  if verification ? 'auction' then
   facts:=verification->'auction';
   perform private.consignment_time(facts->>'closing');
   if coalesce(facts->>'batchUrl','') !~ '^https://' or jsonb_typeof(facts->'cards') is distinct from 'array' or jsonb_array_length(facts->'cards') not between 1 and 50 then raise exception using errcode='22023',message='Check the reviewed auction facts.'; end if;
   for item in select value from jsonb_array_elements(facts->'cards') loop
    if jsonb_typeof(item->'name') is distinct from 'string' or jsonb_typeof(item->'url') is distinct from 'string' then raise exception using errcode='22023',message='Check the reviewed lot names and links.'; end if;
   end loop;
  end if;
  if verification ? 'results' then
   if jsonb_typeof(verification->'results') is distinct from 'array' or jsonb_array_length(verification->'results')>50 then raise exception using errcode='22023',message='Lot results must be a list.'; end if;
   for item in select value from jsonb_array_elements(verification->'results') loop
    if coalesce(item->>'url','') !~ '^https://' or coalesce(item->>'outcome','') not in ('unknown','sold','unsold','withdrawn') or (item ? 'price' and (jsonb_typeof(item->'price') is distinct from 'number' or (item->>'price')::numeric<=0 or item->>'outcome'<>'sold' or coalesce(item->>'currency','') !~ '^[A-Z]{3}$')) then raise exception using errcode='22023',message='Check recorded lot outcomes and verified sale prices.'; end if;
   end loop;
  end if;
  key:='contributors';
 end if;
 if d-keys <> '{}'::jsonb then raise exception using errcode='22023',message='Approval, budget, history and publishing fields are controlled by their own actions.'; end if;
 if jsonb_typeof(d->key) is distinct from 'array' or jsonb_array_length(d->key)>50 then raise exception using errcode='22023',message='Choose up to 50 active team members.'; end if;
 for item in select value from jsonb_array_elements(d->key) loop
  if jsonb_typeof(item)<>'string' or not private.hq_active(w,item#>>'{}') then raise exception using errcode='22023',message='Choose active members of this organization.'; end if;
 end loop;
end $$;

create or replace function private.hq_can_work(d jsonb,p jsonb,s text) returns boolean language sql stable set search_path='' as $$
 select coalesce(private.staff_role()='admin' or d->>'owner'=s or d->'contributors'?s or p->>'owner'=s or p->'members'?s or (coalesce(d->>'projectId','')='' and d->>'approver'=s),false)
$$;
create or replace function private.hq_approver(d jsonb,p jsonb) returns text language sql immutable set search_path='' as $$
 select case when coalesce(d->>'projectId','')='' then d->>'approver' else p->>'owner' end
$$;
create or replace function private.hq_current_approval(d jsonb,p jsonb) returns boolean language sql stable set search_path='' as $$
 select coalesce(d->'approval'->>'by'=private.hq_approver(d,p)
 and private.hq_active(private.workspace(),d->'approval'->>'by')
 and (coalesce(d->>'projectId','')='' or (d->'approval'->'projectVersion'=p->'version' and p->'budget'<>'null'::jsonb and p->>'status'='active')),false)
$$;

-- Old rows remain intact, but cannot compete with their adopted HQ record.
create or replace function private.hq_legacy_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.kind='campaign' and exists(select 1 from public.marketing_records where workspace_id=old.workspace_id and kind='project' and data->>'legacyCampaignId'=old.id))
 or (old.kind='post' and exists(select 1 from public.marketing_records where workspace_id=old.workspace_id and kind='deliverable' and data->>'legacyPostId'=old.id)) then
  raise exception using errcode='22023',message='This record is managed in Northside HQ. Open its project or deliverable.';
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists hq_legacy_guard on public.marketing_records;
create trigger hq_legacy_guard before update or delete on public.marketing_records for each row when(old.kind in ('post','campaign')) execute function private.hq_legacy_guard();

create or replace function private.hq_legacy_insert_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='post' and exists(select 1 from public.marketing_records where workspace_id=new.workspace_id and kind='project' and data->>'legacyCampaignId'=new.data->'consignment'->>'campaignId') then
  raise exception using errcode='22023',message='This campaign is managed in Northside HQ. Add deliverables to its project.';
 end if;
 return new;
end $$;
drop trigger if exists hq_legacy_insert_guard on public.marketing_records;
create trigger hq_legacy_insert_guard before insert on public.marketing_records for each row when(new.kind='post') execute function private.hq_legacy_insert_guard();

create or replace function private.hq_adopt_post(w text,legacy_id text,project_id text) returns jsonb language plpgsql set search_path='' as $$
declare old jsonb; d jsonb; i text; dest jsonb; owner_id text;
begin
 select id into i from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'legacyPostId'=legacy_id;
 if i is not null then return jsonb_build_object('id',i); end if;
 select data into old from public.marketing_records where workspace_id=w and kind='post' and id=legacy_id;
 if old is null then raise exception using errcode='22023',message='Calendar post was not found.'; end if;
 if old ? 'radarId' or legacy_id like 'radar_%' or old ? 'recurrence' then raise exception using errcode='22023',message='Editorial copies and recurring templates remain in their existing editors. Create a dated occurrence first.'; end if;
 if old ? 'consignment' and project_id='' then raise exception using errcode='22023',message='Adopt the whole campaign to preserve its production checks.'; end if;
 select coalesce(jsonb_agg(distinct value),'[]'::jsonb) into dest from jsonb_array_elements_text(coalesce(old->'platforms',jsonb_build_array(old->>'source'))) where value in ('facebook','instagram','x','youtube','tiktok','snapchat','email','website');
 owner_id:=case when private.hq_active(w,old->>'owner') then old->>'owner' else '' end;
 d:=jsonb_build_object('title',old->>'title','instructions','','owner',owner_id,'contributors','[]'::jsonb,'projectId',project_id,'approver','','productionDue','','publishAt',private.hq_time(old->>'date'),'format','','platforms',dest,'caption',coalesce(old->>'caption',''),'destinationUrl','','effort',null,'estimatedHours',null,'publishing',true,'blocked',false,'blockedReason','','blockedBy','','assets','[]'::jsonb,'references',coalesce(old->'references','[]'::jsonb),'evidence',jsonb_build_object('completedTasks',coalesce(old->'completedTasks','[]'::jsonb),'staffPicks',coalesce(old->>'staffPicks',''),'verification',coalesce(old->'verification','{}'::jsonb)),
 'status','to_do','approval',null,'version',1,'legacyPostId',legacy_id,'legacyPost',old,'createdBy',private.hq_staff_id(),'createdAt',now(),'updatedAt',now());
 select coalesce(jsonb_object_agg(value,jsonb_build_object('status','planned')),'{}'::jsonb) into dest from jsonb_array_elements_text(dest);
 d:=d||jsonb_build_object('publications',dest); i:=gen_random_uuid()::text;
 return private.hq_put(w,'deliverable',i,d,'adopted calendar record; legacy status is unconfirmed in HQ');
end $$;

create or replace function private.hq(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); adm boolean:=private.staff_role()='admin';
 k text; i text:=p_payload->>'id'; d jsonb:=p_payload->'data'; old jsonb; p jsonb; target jsonb; entry jsonb; result jsonb;
 version integer; total bigint; amount bigint; dest text; next_status text; approver text; row record; key text;
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>150000 then raise exception using errcode='22023',message='Check request fields and size.'; end if;
 if p_action='context' then
  return jsonb_build_object('staffId',s,'admin',adm,'canApproveBudget',exists(select 1 from private.hq_permissions where org_id=w and staff_id=s and enabled),
   'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'budgetApprover',exists(select 1 from private.hq_permissions c where c.org_id=w and c.staff_id=a.id and c.enabled)) order by a.name),'[]'::jsonb) from private.staff_access a where a.org_id=w and a.active));
 end if;
 if p_action='permission' then
  if not adm then raise exception using errcode='42501',message='Only workspace administrators manage budget permissions.'; end if;
  if not private.hq_active(w,p_payload->>'staffId') or jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception using errcode='22023',message='Choose an active staff member and permission.'; end if;
  insert into private.hq_permissions values(w,p_payload->>'staffId','budget_approve',(p_payload->>'enabled')::boolean) on conflict(org_id,staff_id,capability) do update set enabled=excluded.enabled;
  perform private.hq_log(w,'permission',p_payload->>'staffId',p_payload,'budget permission changed'); return '{}'::jsonb;
 end if;
 if p_action='adopt-campaign' then
  select id,data into row from public.marketing_records where workspace_id=w and kind='project' and data->>'legacyCampaignId'=i;
  if found then return jsonb_build_object('id',row.id); end if;
  select data into old from public.marketing_records where workspace_id=w and kind='campaign' and id=i;
  if old is null then raise exception using errcode='22023',message='Campaign was not found.'; end if;
  if not adm and old->>'owner' is distinct from s then raise exception using errcode='42501',message='Only the campaign owner or administrator can adopt it.'; end if;
  d:=jsonb_build_object('title',old->>'name','type','weekly_auction','brief','','owner',case when private.hq_active(w,old->>'owner') then old->>'owner' else '' end,'members','[]'::jsonb,'status','draft','eventAt','','auctionOpensAt',private.hq_time(old->>'opening'),'auctionClosesAt',private.hq_time(old->>'closing'),'assets','[]'::jsonb,'references',jsonb_build_array(old->>'batchUrl'),'allocations','[]'::jsonb,'auction',jsonb_build_object('auctionPlatform',old->>'auctionPlatform','batchUrl',old->>'batchUrl','cards',old->'cards'),'budget',null,'legacyCampaignId',i,'version',1,'createdBy',s,'createdAt',now(),'updatedAt',now());
  key:=gen_random_uuid()::text; result:=private.hq_put(w,'project',key,d,'adopted campaign');
  for row in select id from public.marketing_records where workspace_id=w and kind='post' and data->'consignment'->>'campaignId'=i loop perform private.hq_adopt_post(w,row.id,key); end loop;
  return result;
 end if;
 if p_action='adopt-post' then
  select id into key from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'legacyPostId'=i;
  if key is not null then return jsonb_build_object('id',key); end if;
  select data into old from public.marketing_records where workspace_id=w and kind='post' and id=i;
  if not adm and old->>'owner' is distinct from s then raise exception using errcode='42501',message='Only the existing owner or administrator can adopt it.'; end if;
  return private.hq_adopt_post(w,i,'');
 end if;
 k:=case when p_action in ('save-project','budget') then 'project' when p_action='comment' then p_payload->>'kind' else 'deliverable' end;
 if k not in ('project','deliverable') or i is null or i !~ '^[a-zA-Z0-9_-]{1,180}$' then raise exception using errcode='22023',message='Choose a valid HQ record.'; end if;
 select data into old from public.marketing_records where workspace_id=w and kind=k and id=i;
 if p_action='comment' then
  if old is null then raise exception using errcode='22023',message='Record was not found.'; end if;
  if coalesce(length(btrim(p_payload->>'body')),0) not between 1 and 5000 then raise exception using errcode='22023',message='Add a comment (up to 5000 characters).'; end if;
  insert into public.hq_comments values(w,(p_payload->>'commentId')::uuid,k,i,s,p_payload->>'body',now()) on conflict do nothing;
  return '{}'::jsonb;
 end if;
 if coalesce(p_payload->>'version','') !~ '^\d{1,8}$' or (p_payload->>'version')::int<>coalesce((old->>'version')::int,0) then raise exception using errcode='40001',message='Someone changed this record. Reload and review before saving.'; end if;
 version:=coalesce((old->>'version')::int,0)+1;
 if old is null and p_action not in ('save-project','save-deliverable') then raise exception using errcode='22023',message='Record was not found.'; end if;
 if k='deliverable' then
  select data into p from public.marketing_records where workspace_id=w and kind='project' and id=old->>'projectId';
  approver:=private.hq_approver(old,p);
 end if;
 if p_action='save-project' then
  perform private.hq_validate(w,k,d);
  if old is not null and not adm and old->>'owner' is distinct from s and not (old->>'owner'='' and old->>'createdBy'=s and d->>'owner' in ('',s)) then raise exception using errcode='42501',message='Only the project owner or administrator can edit this project.'; end if;
  if old is null and not adm and d->>'owner' not in ('',s) then raise exception using errcode='42501',message='Create your own project; an administrator can assign another owner.'; end if;
  if (old is null and jsonb_array_length(d->'allocations')>0) or (old is not null and old->'allocations' is distinct from d->'allocations' and old->>'owner' is distinct from s) then raise exception using errcode='42501',message='Only the current project owner allocates an approved budget.'; end if;
  select coalesce(sum((value->>'amountCents')::bigint),0) into total from jsonb_array_elements(d->'allocations');
  if total>coalesce((old->'budget'->>'amountCents')::bigint,0) then raise exception using errcode='22023',message='Channel allocations exceed the approved budget.'; end if;
  if old->>'legacyCampaignId' is not null and d->'auction'='null'::jsonb then raise exception using errcode='22023',message='Keep the adopted auction facts and featured lot links.'; end if;
  d:=coalesce(old,'{}'::jsonb)||d||jsonb_build_object('budget',old->'budget');
 elsif p_action='budget' then
  if not exists(select 1 from private.hq_permissions where org_id=w and staff_id=s and capability='budget_approve' and enabled) then raise exception using errcode='42501',message='Budget approval permission is required.'; end if;
  if jsonb_typeof(p_payload->'amountCents') is distinct from 'number' or p_payload->>'amountCents' !~ '^\d{1,12}$' then raise exception using errcode='22023',message='Use a nonnegative budget in whole cents.'; end if;
  amount:=(p_payload->>'amountCents')::bigint;
  select coalesce(sum((value->>'amountCents')::bigint),0) into total from jsonb_array_elements(old->'allocations');
  if amount<total then raise exception using errcode='22023',message='The budget cannot be less than existing channel allocations.'; end if;
  d:=old||jsonb_build_object('budget',jsonb_build_object('amountCents',amount,'currency','USD','approvedBy',s,'approvedAt',now(),'version',coalesce((old->'budget'->>'version')::int,0)+1));
 elsif p_action='save-deliverable' then
  perform private.hq_validate(w,k,d);
  if old is not null and not private.hq_can_work(old,p,s) then raise exception using errcode='42501',message='Only assigned people, project members or the approver can edit this work.'; end if;
  if old is not null and (old->>'projectId' is distinct from d->>'projectId' or old->>'approver' is distinct from d->>'approver' or old->>'owner' is distinct from d->>'owner' or old->'contributors' is distinct from d->'contributors') and not adm and approver is distinct from s then raise exception using errcode='42501',message='Only the current approver or administrator can change assignments or move work.'; end if;
  select data into target from public.marketing_records where workspace_id=w and kind='project' and id=d->>'projectId';
  if d->>'projectId'<>'' and target is null then raise exception using errcode='22023',message='Choose a project in this organization.'; end if;
  if d->>'projectId'<>'' and (old is null or old->>'projectId' is distinct from d->>'projectId') and not adm and not coalesce(target->>'owner'=s or target->'members'?s,false) then raise exception using errcode='42501',message='Only project members can add or move work into this project.'; end if;
  if target->>'status' in ('completed','archived') then raise exception using errcode='22023',message='Reopen the project before editing production work.'; end if;
  if old is not null and exists(select 1 from jsonb_each(old->'publications') where value->>'status' in ('scheduled','published')) then raise exception using errcode='22023',message='Confirmed work is locked. Cancel platform scheduling first, or create follow-up work for published material.'; end if;
  if old->>'legacyPostId' is not null and old->'legacyPost' ? 'consignment' and old->>'projectId' is distinct from d->>'projectId' then raise exception using errcode='22023',message='Keep adopted campaign deliverables with their project.'; end if;
  select coalesce(jsonb_object_agg(value,jsonb_build_object('status','planned')),'{}'::jsonb) into entry from jsonb_array_elements_text(d->'platforms');
  d:=coalesce(old,'{}'::jsonb)||d||jsonb_build_object('status',case when old->>'status' in ('ready','done') then 'needs_review' else coalesce(old->>'status','to_do') end,'approval',null,'publications',entry);
 elsif p_action='production' then
  if not private.hq_can_work(old,p,s) then raise exception using errcode='42501',message='Only assigned people, project members or the approver can change production.'; end if;
  next_status:=p_payload->>'status';
  if coalesce(next_status,'') not in ('to_do','in_progress','needs_review','ready','done') then raise exception using errcode='22023',message='Choose a production state.'; end if;
  if next_status<>old->>'status' and not (
    (old->>'status'='to_do' and next_status='in_progress') or
    (old->>'status'='in_progress' and next_status in ('to_do','needs_review')) or
    (old->>'status'='needs_review' and next_status in ('in_progress','ready')) or
    (old->>'status'='ready' and next_status in ('needs_review','done')) or
    (old->>'status'='done' and next_status='in_progress')) then raise exception using errcode='22023',message='Move through To do, In progress, Needs review and Ready in order.'; end if;
  if exists(select 1 from jsonb_each(old->'publications') where value->>'status'='scheduled') and next_status<>'ready' then raise exception using errcode='22023',message='Cancel scheduling on each platform before reopening production.'; end if;
  if old->'publishing'='true'::jsonb and next_status='done' then raise exception using errcode='22023',message='Record each publishing destination separately.'; end if;
  d:=old||jsonb_build_object('status',next_status);
  if next_status='ready' then
   if approver is distinct from s then raise exception using errcode='42501',message='Only the project owner or designated standalone approver can approve.'; end if;
   if not private.hq_active(w,old->>'owner') or coalesce(btrim(old->>'instructions'),'')='' or coalesce(old->>'productionDue','')='' or coalesce(old->>'effort','')='' or old->'blocked'='true'::jsonb then raise exception using errcode='22023',message='Resolve missing owner, instructions, deadline, effort or blocked work before approval.'; end if;
   if old->'publishing'='true'::jsonb and (old->>'publishAt'='' or btrim(old->>'format')='' or btrim(old->>'caption')='' or jsonb_array_length(old->'platforms')=0) then raise exception using errcode='22023',message='Publishing approval needs a format, caption, destinations and intended time.'; end if;
   if old->>'projectId'<>'' and (p->'budget'='null'::jsonb or p->'budget' is null or p->>'status'<>'active' or not private.hq_active(w,p->>'owner')) then raise exception using errcode='22023',message='Activate the project and establish its approved budget before approval (zero is allowed).'; end if;
   if old->'legacyPost' ? 'consignment' then
    entry:=(old->'legacyPost')||(old->'evidence')||jsonb_build_object('date',old->>'publishAt','caption',old->>'caption','references',old->'references','assets',coalesce(old->'legacyPost'->'assets','[]'::jsonb)||(old->'assets'),'status','approved');
    perform private.assert_consignment_approval(entry,(p->'auction')||jsonb_build_object('closing',p->>'auctionClosesAt'));
   end if;
   d:=d||jsonb_build_object('approval',jsonb_build_object('by',s,'at',now(),'projectVersion',p->'version','budgetVersion',p->'budget'->'version'));
  elsif next_status='done' then
   if old->'blocked'='true'::jsonb or not private.hq_current_approval(old,p) then raise exception using errcode='22023',message='Current owner approval is required before Done.'; end if;
  else d:=d||jsonb_build_object('approval',null);
  end if;
 elsif p_action='publication' then
  if not private.hq_can_work(old,p,s) then raise exception using errcode='42501',message='Only assigned people, project members or the approver can record publishing.'; end if;
  dest:=p_payload->>'platform'; next_status:=p_payload->>'status'; entry:=old->'publications'->dest;
  if old->'publishing'<>'true'::jsonb or entry is null or coalesce(next_status,'') not in ('planned','scheduled','published') then raise exception using errcode='22023',message='Choose a destination on this publishing deliverable.'; end if;
  if entry->>'status'='published' then raise exception using errcode='22023',message='Published facts are permanent. Add a comment for corrections or create follow-up work.'; end if;
  if p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception using errcode='22023',message='Explicitly confirm the action on the actual platform.'; end if;
  if next_status<>'planned' and (old->>'status'<>'ready' or old->'blocked'='true'::jsonb or not private.hq_current_approval(old,p)) then raise exception using errcode='22023',message='Current owner approval and unblocked Ready work are required.'; end if;
  if next_status='scheduled' then
   perform private.consignment_time(p_payload->>'time');
   entry:=jsonb_build_object('status','scheduled','scheduledFor',p_payload->>'time','scheduledBy',s,'scheduledAt',now());
  elsif next_status='published' then
   if private.consignment_time(p_payload->>'time')>now()+interval '1 minute' then raise exception using errcode='22023',message='The actual publication time cannot be in the future.'; end if;
   if coalesce(p_payload->>'url','')='' then
    if coalesce(length(btrim(p_payload->>'unavailableReason')),0) not between 5 and 1000 then raise exception using errcode='22023',message='Add the live URL, or explain why no live URL is available.'; end if;
   elsif p_payload->>'url' !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' or length(p_payload->>'url')>2000 then raise exception using errcode='22023',message='Use an HTTPS live URL without credentials.'; end if;
   entry:=entry||jsonb_build_object('status','published','publishedAt',p_payload->>'time','liveUrl',coalesce(p_payload->>'url',''),'unavailableReason',coalesce(p_payload->>'unavailableReason',''),'recordedBy',s,'recordedAt',now(),'approval',old->'approval');
  else entry:=jsonb_build_object('status','planned','cancelledBy',s,'cancelledAt',now());
  end if;
  d:=old||jsonb_build_object('publications',jsonb_set(old->'publications',array[dest],entry));
 else raise exception using errcode='22023',message='Unknown HQ action.';
 end if;
 d:=d||jsonb_build_object('version',version,'createdBy',coalesce(old->>'createdBy',s),'createdAt',coalesce(old->'createdAt',to_jsonb(now())),'updatedAt',now());
 result:=private.hq_put(w,k,i,d,p_action||case when p_action='publication' then ': '||dest||' '||next_status when p_action='production' then ': '||next_status else '' end);
 if k='project' then
  -- Pending work must visibly return to review, as well as fail the publication gate.
  -- Completed publication facts and completed nonpublishing tasks remain history.
  for row in select id,data from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'projectId'=i and data->>'status'='ready'
   and (data->'publishing'='false'::jsonb or exists(select 1 from jsonb_each(data->'publications') where value->>'status'<>'published')) loop
   perform private.hq_put(w,'deliverable',row.id,row.data||jsonb_build_object('status','needs_review','approval',null,'version',(row.data->>'version')::int+1,'updatedAt',now()),'project change requires review');
  end loop;
 end if;
 return result;
end $$;

create or replace function public.hub_hq(p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.hq(p_action,p_payload)$$;
revoke all on function private.hq_staff_id(),private.hq_active(text,text),private.hq_time(text),private.hq_log(text,text,text,jsonb,text),private.hq_put(text,text,text,jsonb,text),private.hq_common(text,jsonb),private.hq_validate(text,text,jsonb),private.hq_can_work(jsonb,jsonb,text),private.hq_approver(jsonb,jsonb),private.hq_current_approval(jsonb,jsonb),private.hq_legacy_guard(),private.hq_legacy_insert_guard(),private.hq_adopt_post(text,text,text),private.hq(text,jsonb),public.hub_hq(text,jsonb) from public,anon,authenticated;
grant execute on function private.hq(text,jsonb),public.hub_hq(text,jsonb) to authenticated;
commit;
