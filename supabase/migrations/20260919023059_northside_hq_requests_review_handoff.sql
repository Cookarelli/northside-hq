begin;
-- Additive: old records, approvals and storage objects are not rewritten.
alter table private.hq_permissions drop constraint if exists hq_permissions_capability_check;
alter table private.hq_permissions add constraint hq_permissions_capability_check check(capability in ('budget_approve','coordinate_requests'));
insert into private.hq_permissions(org_id,staff_id,capability)
 select org_id,id,'coordinate_requests' from private.staff_access where active and role='admin' on conflict do nothing;
alter table public.hq_comments drop constraint if exists hq_comments_kind_check;
alter table public.hq_comments add constraint hq_comments_kind_check check(kind in ('project','deliverable','request'));
create index if not exists hq_request_target on public.marketing_records(workspace_id,(data->'conversion'->>'kind'),(data->'conversion'->>'id')) where kind='request';
create or replace function private.hq_capability(w text,s text,c text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.hq_permissions where org_id=w and staff_id=s and capability=c and enabled)
$$;
create or replace function private.hq_materials(d jsonb,reference_only boolean default false) returns void language plpgsql set search_path='' as $$
declare k text; x record;
begin
 foreach k in array array['assetRoles','linkRoles'] loop
  if jsonb_typeof(coalesce(d->k,'{}'))<>'object' then raise exception using errcode='22023',message='Check material classifications.'; end if;
  for x in select * from jsonb_each_text(coalesce(d->k,'{}')) loop
   if x.value not in ('reference','draft','final') or (reference_only and x.value<>'reference') or not (d->case when k='assetRoles' then 'assets' else 'references' end ? x.key) then raise exception using errcode='22023',message='Classify attached materials only. Requests contain reference material.'; end if;
  end loop;
 end loop;
end $$;
create or replace function private.hq_promotion(w text,i text,d jsonb,p jsonb) returns void language plpgsql set search_path='' as $$
declare cap bigint; used bigint;
begin
 if d->>'promotionMode'='paid' then
  select (value->>'amountCents')::bigint into cap from jsonb_array_elements(p->'allocations') where value->>'channel'=d->>'promotionChannel';
  select coalesce(sum((data->>'promotionCents')::bigint),0) into used from public.marketing_records where workspace_id=w and kind='deliverable' and id<>i and data->>'projectId'=d->>'projectId' and data->>'promotionMode'='paid' and data->>'promotionChannel'=d->>'promotionChannel';
  if coalesce(d->>'projectId','')='' or p->'budget' is null or p->'budget'='null'::jsonb or cap is null or coalesce((d->>'promotionCents')::bigint,0)<=0 or used+(d->>'promotionCents')::bigint>cap then raise exception using errcode='22023',message='Paid promotion must fit an approved project channel allocation, including other deliverables.'; end if;
 end if;
end $$;
create or replace function private.hq_package(d jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('finalAssets',coalesce((select jsonb_agg(value) from jsonb_array_elements_text(d->'assets') where d->'assetRoles'->>value='final'),'[]'::jsonb),'finalLinks',coalesce((select jsonb_agg(value) from jsonb_array_elements_text(d->'references') where d->'linkRoles'->>value='final'),'[]'::jsonb),'caption',d->'caption','destinationUrl',d->'destinationUrl','publisher',d->'publisher','platforms',d->'platforms','publishAt',d->'publishAt','promotionMode',d->'promotionMode','promotionChannel',d->'promotionChannel','promotionCents',d->'promotionCents')
$$;
create or replace function private.hq_validate(w text,k text,d jsonb) returns void language plpgsql set search_path='' as $$
declare key text; item jsonb; total bigint; keys text[]; verification jsonb; facts jsonb;
begin
 perform private.hq_common(w,d); perform private.hq_materials(d);
 if k='project' then
  keys:=array['title','type','brief','owner','members','status','eventAt','auctionOpensAt','auctionClosesAt','assets','references','allocations','auction','assetRoles','linkRoles'];
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
  keys:=array['title','instructions','owner','contributors','projectId','approver','productionDue','publishAt','format','platforms','caption','destinationUrl','effort','estimatedHours','publishing','blocked','blockedReason','blockedBy','assets','references','evidence','assetRoles','linkRoles','publisher','requiresFinalFile','requiresCaption','promotionMode','promotionChannel','promotionCents'];
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
  if jsonb_typeof(d->'publisher') is distinct from 'string' or (d->>'publisher'<>'' and not private.hq_active(w,d->>'publisher')) then raise exception using errcode='22023',message='Choose an active assigned publisher.'; end if;
  if jsonb_typeof(d->'requiresFinalFile') is distinct from 'boolean' or jsonb_typeof(d->'requiresCaption') is distinct from 'boolean' then raise exception using errcode='22023',message='Choose whether this deliverable needs a final file and caption.'; end if;
  if coalesce(d->>'promotionMode','') not in ('organic','paid') or jsonb_typeof(d->'promotionChannel') is distinct from 'string' or jsonb_typeof(d->'promotionCents') is distinct from 'number' or d->>'promotionCents' !~ '^\d{1,12}$' or (d->>'promotionMode'='organic' and (d->>'promotionCents'<>'0' or d->>'promotionChannel'<>'')) or (d->'publishing'='false'::jsonb and d->>'promotionMode'='paid') then raise exception using errcode='22023',message='Choose organic content or a paid promotion allocation.'; end if;
  key:='contributors';
 end if;
 if d-keys <> '{}'::jsonb then raise exception using errcode='22023',message='Approval, budget, history and publishing fields are controlled by their own actions.'; end if;
 if jsonb_typeof(d->key) is distinct from 'array' or jsonb_array_length(d->key)>50 then raise exception using errcode='22023',message='Choose up to 50 active team members.'; end if;
 for item in select value from jsonb_array_elements(d->key) loop
  if jsonb_typeof(item)<>'string' or not private.hq_active(w,item#>>'{}') then raise exception using errcode='22023',message='Choose active members of this organization.'; end if;
 end loop;
end $$;
create or replace function private.hq_can_work(d jsonb,p jsonb,s text) returns boolean language sql stable set search_path='' as $$
 select coalesce(private.staff_role()='admin' or d->>'owner'=s or d->>'publisher'=s or d->'contributors'?s or p->>'owner'=s or p->'members'?s or (coalesce(d->>'projectId','')='' and d->>'approver'=s),false)
$$;
create or replace function private.hq_current_approval(d jsonb,p jsonb) returns boolean language sql stable set search_path='' as $$
 select coalesce(d->'approval'->>'by'=private.hq_approver(d,p) and private.hq_active(private.workspace(),d->'approval'->>'by')
 and d->'approval'->'contentVersion'=d->'contentVersion' and d->'approval' ? 'approvedVersion' and jsonb_typeof(d->'approval'->'package')='object'
 and (coalesce(d->>'projectId','')='' or (d->'approval'->'projectVersion'=p->'version' and p->>'status'='active' and (d->>'promotionMode'<>'paid' or p->'budget'<>'null'::jsonb))),false)
$$;

-- Request helper is defined below; all mutations use the workspace lock.
create or replace function private.hq(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); adm boolean:=private.staff_role()='admin';
 k text; i text:=p_payload->>'id'; d jsonb:=p_payload->'data'; old jsonb; p jsonb; target jsonb; entry jsonb; result jsonb;
 version integer; total bigint; amount bigint; dest text; next_status text; approver text; row record; key text; comment_text text;
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>150000 then raise exception using errcode='22023',message='Check request fields and size.'; end if;
 if p_action='context' then
  return jsonb_build_object('staffId',s,'admin',adm,'canApproveBudget',private.hq_capability(w,s,'budget_approve'),'canCoordinate',private.hq_capability(w,s,'coordinate_requests'),
   'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'budgetApprover',private.hq_capability(w,a.id,'budget_approve'),'requestCoordinator',private.hq_capability(w,a.id,'coordinate_requests')) order by a.name),'[]'::jsonb) from private.staff_access a where a.org_id=w and a.active));
 end if;
 if p_action='permission' then
  if not adm then raise exception using errcode='42501',message='Only workspace administrators manage permissions.'; end if;
  key:=coalesce(p_payload->>'capability','budget_approve');
  if key not in ('budget_approve','coordinate_requests') or not private.hq_active(w,p_payload->>'staffId') or jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception using errcode='22023',message='Choose an active staff member and permission.'; end if;
  insert into private.hq_permissions values(w,p_payload->>'staffId',key,(p_payload->>'enabled')::boolean) on conflict(org_id,staff_id,capability) do update set enabled=excluded.enabled;
  perform private.hq_log(w,'permission',p_payload->>'staffId',p_payload,'permission changed'); return '{}'::jsonb;
 end if;
 if p_action in ('save-request','decide-request') then return private.hq_request(p_action,p_payload); end if;
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
 if k not in ('project','deliverable','request') or i is null or i !~ '^[a-zA-Z0-9_-]{1,180}$' then raise exception using errcode='22023',message='Choose a valid HQ record.'; end if;
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
  if old is null and not adm and not private.hq_capability(w,s,'coordinate_requests') and d->>'owner' not in ('',s) then raise exception using errcode='42501',message='Create your own project; an administrator can assign another owner.'; end if;
  if (old is null and jsonb_array_length(d->'allocations')>0) or (old is not null and old->'allocations' is distinct from d->'allocations' and old->>'owner' is distinct from s) then raise exception using errcode='42501',message='Only the current project owner allocates an approved budget.'; end if;
  select coalesce(sum((value->>'amountCents')::bigint),0) into total from jsonb_array_elements(d->'allocations');
  if total>coalesce((old->'budget'->>'amountCents')::bigint,0) then raise exception using errcode='22023',message='Channel allocations exceed the approved budget.'; end if;
  if exists(select 1 from (select r.data->>'promotionChannel' channel,sum((r.data->>'promotionCents')::bigint) used from public.marketing_records r where r.workspace_id=w and r.kind='deliverable' and r.data->>'projectId'=i and r.data->>'promotionMode'='paid' group by r.data->>'promotionChannel') commitments where used>coalesce((select (value->>'amountCents')::bigint from jsonb_array_elements(d->'allocations') where value->>'channel'=commitments.channel),0)) then raise exception using errcode='22023',message='Channel allocations cannot be less than committed deliverable promotion.'; end if;
  if old->>'legacyCampaignId'  is not null and d->'auction'='null'::jsonb then raise exception using errcode='22023',message='Keep the adopted auction facts and featured lot links.'; end if;
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
  if old is not null and (old->>'projectId' is distinct from d->>'projectId' or old->>'approver' is distinct from d->>'approver' or old->>'owner' is distinct from d->>'owner' or old->'contributors' is distinct from d->'contributors' or coalesce(old->>'publisher','') is distinct from d->>'publisher' or coalesce(old->>'promotionMode','organic') is distinct from d->>'promotionMode' or coalesce(old->>'promotionCents','0') is distinct from d->>'promotionCents' or coalesce(old->>'promotionChannel','') is distinct from d->>'promotionChannel') and not adm and approver is distinct from s then raise exception using errcode='42501',message='Only the current approver or administrator can change assignments or move work.'; end if;
  select data into target from public.marketing_records where workspace_id=w and kind='project' and id=d->>'projectId';
  if d->>'projectId'<>'' and target is null then raise exception using errcode='22023',message='Choose a project in this organization.'; end if;
  if d->>'projectId'<>'' and (old is null or old->>'projectId' is distinct from d->>'projectId') and not adm and not coalesce(target->>'owner'=s or target->'members'?s,false) then raise exception using errcode='42501',message='Only project members can add or move work into this project.'; end if;
  if d->>'promotionMode'='paid' and (old is null or old->>'projectId' is distinct from d->>'projectId') and target->>'owner' is distinct from s then raise exception using errcode='42501',message='The project owner assigns promotion within the approved channel budget.'; end if;
  if old is not null and (coalesce(old->>'promotionMode','organic') is distinct from d->>'promotionMode' or coalesce(old->>'promotionCents','0') is distinct from d->>'promotionCents' or coalesce(old->>'promotionChannel','') is distinct from d->>'promotionChannel') and approver is distinct from s then raise exception using errcode='42501',message='Only the current approver can change promotion allocations.'; end if;
  perform private.hq_promotion(w,i,d,target);
  if target->>'status'  in ('completed','archived') then raise exception using errcode='22023',message='Reopen the project before editing production work.'; end if;
  if old is not null and exists(select 1 from jsonb_each(old->'publications') where value->>'status' in ('scheduled','published')) then raise exception using errcode='22023',message='Confirmed work is locked. Cancel platform scheduling first, or create follow-up work for published material.'; end if;
  if old->>'legacyPostId' is not null and old->'legacyPost' ? 'consignment' and old->>'projectId' is distinct from d->>'projectId' then raise exception using errcode='22023',message='Keep adopted campaign deliverables with their project.'; end if;
  select coalesce(jsonb_object_agg(value,jsonb_build_object('status','planned')),'{}'::jsonb) into entry from jsonb_array_elements_text(d->'platforms');
  d:=coalesce(old,'{}'::jsonb)||d||jsonb_build_object('status',case when old->>'status' in ('needs_review','ready','done') then 'in_progress' else coalesce(old->>'status','to_do') end,'approval',null,'submission',null,'contentVersion',coalesce((old->>'contentVersion')::int,0)+1,'publications',entry);
 elsif p_action in ('production','review') then
  if not private.hq_can_work(old,p,s) then raise exception using errcode='42501',message='Only assigned people, project members or the approver can change production.'; end if;
  next_status:=case when p_action='review' then case when p_payload->>'decision'='approve' then 'ready' else 'in_progress' end else p_payload->>'status' end;
  comment_text:=btrim(coalesce(p_payload->>'comment',''));
  if p_action='review' and (coalesce(p_payload->>'decision','') not in ('approve','changes') or length(comment_text)>5000 or (p_payload->>'decision'='changes' and comment_text='')) then raise exception using errcode='22023',message='Request changes with a comment (up to 5000 characters).'; end if;
  if p_action='review' and (approver is distinct from s or old->>'status'<>'needs_review') then raise exception using errcode='42501',message='Only the current approver can review submitted work.'; end if;
  if coalesce(next_status,'') not in ('to_do','in_progress','needs_review','ready','done') then raise exception using errcode='22023',message='Choose a production state.'; end if;
  if next_status<>old->>'status' and not (
    (old->>'status'='to_do' and next_status='in_progress') or
    (old->>'status'='in_progress' and next_status in ('to_do','needs_review')) or
    (old->>'status'='needs_review' and next_status in ('in_progress','ready')) or
    (old->>'status'='ready' and next_status in ('needs_review','done')) or
    (old->>'status'='done' and next_status='in_progress')) then raise exception using errcode='22023',message='Move through To do, In progress, Needs review and Ready in order.'; end if;
  if exists(select 1 from jsonb_each(old->'publications') where value->>'status' in ('scheduled','published')) and next_status<>'ready' then raise exception using errcode='22023',message='Cancel scheduling on each platform before reopening production.'; end if;
  if old->'publishing'='true'::jsonb and next_status='done' then raise exception using errcode='22023',message='Record each publishing destination separately.'; end if;
  d:=old||jsonb_build_object('status',next_status);
  if next_status='ready' then
   if approver is distinct from s then raise exception using errcode='42501',message='Only the project owner or designated standalone approver can approve.'; end if;
   if not private.hq_active(w,old->>'owner') or coalesce(btrim(old->>'instructions'),'')='' or coalesce(old->>'productionDue','')='' or coalesce(old->>'effort','')='' or old->'blocked'='true'::jsonb then raise exception using errcode='22023',message='Resolve missing owner, instructions, deadline, effort or blocked work before approval.'; end if;
   if old->>'status'<>'needs_review' or old->'submission'->'contentVersion' is distinct from old->'contentVersion' or old->'submission' is null or old->'submission'='null'::jsonb then raise exception using errcode='22023',message='Submit this content version to its approver before approval.'; end if;
   entry:=private.hq_package(old);
   if jsonb_typeof(old->'requiresFinalFile') is distinct from 'boolean' or jsonb_typeof(old->'requiresCaption') is distinct from 'boolean' then raise exception using errcode='22023',message='Choose output requirements and resubmit for review.'; end if;
   if old->'requiresFinalFile'='true'::jsonb and jsonb_array_length(entry->'finalAssets')+jsonb_array_length(entry->'finalLinks')=0 then raise exception using errcode='22023',message='Attach and mark a final file or final external link before approval.'; end if;
   if old->'publishing'='true'::jsonb and (old->>'publishAt'='' or btrim(old->>'format')='' or (old->'requiresCaption'='true'::jsonb and btrim(old->>'caption')='') or jsonb_array_length(old->'platforms')=0 or not private.hq_active(w,old->>'publisher') or (old->'requiresCaption'='false'::jsonb and old->'requiresFinalFile'='false'::jsonb and old->>'destinationUrl'='')) then raise exception using errcode='22023',message='Publishing approval needs its required output, format, destinations, assigned publisher and intended time.'; end if;
   if old->>'projectId'<>'' and (p->>'status'<>'active' or not private.hq_active(w,p->>'owner')) then raise exception using errcode='22023',message='Activate the project and assign an owner before approval.'; end if;
   perform private.hq_promotion(w,i,old,p);
   if old->'legacyPost' ? 'consignment' then
    entry:=(old->'legacyPost')||(old->'evidence')||jsonb_build_object('date',old->>'publishAt','caption',old->>'caption','references',old->'references','assets',coalesce(old->'legacyPost'->'assets','[]'::jsonb)||(old->'assets'),'status','approved');
    perform private.assert_consignment_approval(entry,(p->'auction')||jsonb_build_object('closing',p->>'auctionClosesAt'));
   end if;
   d:=d||jsonb_build_object('approval',jsonb_build_object('by',s,'at',now(),'projectVersion',p->'version','budgetVersion',p->'budget'->'version','reviewedVersion',old->'version','approvedVersion',version,'contentVersion',old->'contentVersion','comment',comment_text,'package',private.hq_package(old)));
  elsif next_status='done' then
   if old->'blocked'='true'::jsonb or not private.hq_current_approval(old,p) then raise exception using errcode='22023',message='Current owner approval is required before Done.'; end if;
  else d:=d||jsonb_build_object('approval',null);
  end if;
  if next_status='needs_review' then
   if not private.hq_active(w,approver) then raise exception using errcode='22023',message='Choose an active project owner or standalone approver before submission.'; end if;
   d:=d||jsonb_build_object('contentVersion',coalesce(old->'contentVersion',old->'version'),'submission',jsonb_build_object('by',s,'to',approver,'at',now(),'contentVersion',coalesce(old->'contentVersion',old->'version'),'recordVersion',version));
  elsif next_status not in ('ready','done') then d:=d||jsonb_build_object('submission',null); end if;
  if p_action='review' or next_status='ready' then
   d:=d||jsonb_build_object('review',jsonb_build_object('by',s,'at',now(),'decision',case when next_status='ready' then 'approve' else 'changes' end,'comment',comment_text,'reviewedVersion',old->'version'));
   if comment_text<>'' then insert into public.hq_comments values(w,gen_random_uuid(),'deliverable',i,s,comment_text,now()); end if;
  end if;
 elsif p_action='publication' then
  if old->>'publisher' is distinct from s and approver is distinct from s then raise exception using errcode='42501',message='Only the assigned publisher or current approver can record publishing.'; end if;
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

create or replace function private.hq_request(act text,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); coord boolean:=private.hq_capability(w,s,'coordinate_requests');
 i text:=payload->>'id'; old jsonb; d jsonb:=payload->'data'; v int; target jsonb; target_id text; target_kind text; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if i is null or i !~ '^[a-zA-Z0-9_-]{1,180}$' then raise exception using errcode='22023',message='Choose a valid request.'; end if;
 select data into old from public.marketing_records where workspace_id=w and kind='request' and id=i;
 if act='decide-request' then
  if not coord then raise exception using errcode='42501',message='Request coordinator permission is required.'; end if;
  if old is null then raise exception using errcode='22023',message='Request was not found.'; end if;
  if old->>'decisionId'=payload->>'decisionId' then
   if old->'decisionInput' is distinct from payload then raise exception using errcode='22023',message='A decision retry must match the original decision.'; end if;
   return jsonb_build_object('id',i,'kind','request','data',old);
  end if;
 end if;
 if old is not null and old->>'status'<>'new' then raise exception using errcode='22023',message='This request has already been decided. Open its linked work.'; end if;
 if coalesce(payload->>'version','') !~ '^\d{1,8}$' or (payload->>'version')::int<>coalesce((old->>'version')::int,0) then raise exception using errcode='40001',message='Someone changed this request. Reload before saving.'; end if;
 v:=coalesce((old->>'version')::int,0)+1;
 if act='save-request' then
  if old is not null and old->>'requester'<>s and not coord then raise exception using errcode='42501',message='Only the requester or a coordinator can edit a new request.'; end if;
  if d-array['title','purpose','requestedDeadline','assets','references','assetRoles','linkRoles']<>'{}'::jsonb then raise exception using errcode='22023',message='Requester and decision fields are managed by the server.'; end if;
  perform private.hq_common(w,d||jsonb_build_object('owner','')); perform private.hq_materials(d,true);
  if jsonb_typeof(d->'purpose') is distinct from 'string' or length(btrim(d->>'purpose')) not between 1 and 6000 or jsonb_typeof(d->'requestedDeadline') is distinct from 'string' then raise exception using errcode='22023',message='Tell us what this is for and check the requested deadline.'; end if;
  if d->>'requestedDeadline'<>'' then perform private.consignment_time(d->>'requestedDeadline'); end if;
  d:=coalesce(old,'{}')||d||jsonb_build_object('requester',coalesce(old->>'requester',s),'status','new');
 elsif act='decide-request' then
  perform (payload->>'decisionId')::uuid;
  if payload->>'decisionId' is null or coalesce(payload->>'decision','') not in ('accepted','declined') or jsonb_typeof(payload->'reason') is distinct from 'string' or length(payload->>'reason')>5000 or (payload->>'decision'='declined' and btrim(payload->>'reason')='') then raise exception using errcode='22023',message='Choose a decision and give a reason when declining.'; end if;
  d:=old||jsonb_build_object('status',payload->>'decision','decisionId',payload->>'decisionId','decisionInput',payload,'decision',jsonb_build_object('by',s,'at',now(),'reason',payload->>'reason'));
  if payload->>'decision'='accepted' then
   target_kind:=payload->>'targetKind'; target_id:=coalesce(payload->>'targetId','');
   if coalesce(target_kind,'') not in ('project','deliverable') then raise exception using errcode='22023',message='Choose a project or standalone deliverable.'; end if;
   if target_id<>'' then
    select data into target from public.marketing_records where workspace_id=w and kind=target_kind and id=target_id;
    if target is null or (target_kind='project' and target->>'status' in ('completed','archived')) or (target_kind='deliverable' and (coalesce(target->>'projectId','')<>'' or target->>'status'='done')) then raise exception using errcode='22023',message='Choose an open project or standalone deliverable in this organization.'; end if;
   else
    target_id:=gen_random_uuid()::text;
    if not private.hq_active(w,payload->>'owner') then raise exception using errcode='22023',message='Choose an accountable owner for the new work.'; end if;
    target:=jsonb_build_object('title',old->'title','owner',payload->>'owner','assets',old->'assets','references',old->'references','assetRoles',coalesce(old->'assetRoles','{}'),'linkRoles',coalesce(old->'linkRoles','{}'));
    if target_kind='project' then
     target:=target||jsonb_build_object('type',payload->>'projectType','brief',old->>'purpose','members','[]'::jsonb,'status','draft','eventAt','','auctionOpensAt','','auctionClosesAt','','allocations','[]'::jsonb,'auction',null);
    else
     target:=target||jsonb_build_object('instructions',old->>'purpose','contributors','[]'::jsonb,'projectId','','approver',payload->>'approver','productionDue','','publishAt','','format','','platforms',payload->'platforms','caption','','destinationUrl','','effort',payload->>'effort','estimatedHours',null,'publishing',payload->'publishing','blocked',false,'blockedReason','','blockedBy','','evidence','{}'::jsonb,'publisher','','requiresFinalFile',payload->'publishing','requiresCaption',payload->'publishing','promotionMode','organic','promotionChannel','','promotionCents',0);
    end if;
    result:=private.hq('save-'||target_kind,jsonb_build_object('id',target_id,'version',0,'data',target)); target:=result->'data';
   end if;
   d:=d||jsonb_build_object('conversion',jsonb_build_object('kind',target_kind,'id',target_id));
   perform private.hq_log(w,target_kind,target_id,target||jsonb_build_object('originRequestId',i),'accepted request');
  end if;
 else raise exception using errcode='22023',message='Unknown request action.';
 end if;
 d:=d||jsonb_build_object('version',v,'createdBy',coalesce(old->>'createdBy',s),'createdAt',coalesce(old->'createdAt',to_jsonb(now())),'updatedAt',now());
 return private.hq_put(w,'request',i,d,act);
end $$;
revoke all on function private.hq_capability(text,text,text),private.hq_materials(jsonb,boolean),private.hq_promotion(text,text,jsonb,jsonb),private.hq_package(jsonb),private.hq_request(text,jsonb) from public,anon,authenticated;
commit;
