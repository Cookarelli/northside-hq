begin;
-- One permanent parent, unique auction numbers, and one reminder of each type per batch.
-- Deleted reminders retain their identity so retries cannot create replacement duplicates.
create unique index if not exists hq_auction_number_unique on public.marketing_records(workspace_id,((data->>'auction_number')::integer)) where kind='auction_campaign';
create unique index if not exists hq_auction_reminder_unique on public.marketing_records(workspace_id,(data->>'auctionCampaignId'),(data->>'reminderHours')) where kind='deliverable' and data->>'auctionCampaignId' is not null and data->>'reminderHours' in ('48','24','2');

create or replace function private.hq_campaign_assigned(d jsonb,s text) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.marketing_records c where c.workspace_id=private.workspace() and c.kind='auction_campaign' and c.id=d->>'auctionCampaignId' and c.data->>'projectId'=d->>'projectId' and (c.data->>'owner'=s or c.data->'assignees'?s))
$$;
revoke all on function private.hq_campaign_assigned(jsonb,text) from public,anon,authenticated;
create or replace function private.hq_can_work(d jsonb,p jsonb,s text) returns boolean language sql stable set search_path='' as $$
 select coalesce(private.staff_role()='admin' or d->>'owner'=s or d->>'publisher'=s or d->'contributors'?s or p->>'owner'=s or p->'members'?s or private.hq_campaign_assigned(d,s) or (coalesce(d->>'projectId','')='' and d->>'approver'=s),false)
$$;
create or replace function private.hq_approval_actor(d jsonb,p jsonb,s text) returns boolean
language sql stable set search_path='' as $$
 select private.hq_active(private.workspace(),s) and coalesce(
  d->>'owner'=s or d->>'publisher'=s or d->'contributors'?s or p->>'owner'=s or p->'members'?s or private.hq_campaign_assigned(d,s)
  or (coalesce(d->>'projectId','')='' and d->>'approver'=s)
  or exists(select 1 from private.staff_access where org_id=private.workspace() and id=s and active and role='admin'),false)
$$;

create or replace function private.hq_validate_auction(w text,d jsonb,complete boolean) returns void
language plpgsql set search_path='' as $$
declare field text; item jsonb; close_at timestamptz;
begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>145000
  or d-array['name','auction_number','closesAt','featuredCard','auctionPlatform','auctionUrl','lotUrls','owner','assignees','assetLinks','internalNotes','campaignBudgetCents']<>'{}'::jsonb
  or not d ?& array['name','auction_number','closesAt'] then raise exception using errcode='22023',message='Check the auction campaign fields.'; end if;
 if complete and not d ?& array['featuredCard','auctionPlatform','auctionUrl','lotUrls','owner','assignees','assetLinks','internalNotes','campaignBudgetCents'] then raise exception using errcode='22023',message='Complete the campaign fields before creating reminders.'; end if;
 if jsonb_typeof(d->'auction_number') is distinct from 'number' or d->>'auction_number' !~ '^[1-9]\d{0,8}$' then raise exception using errcode='22023',message='Use a positive whole auction number.'; end if;
 if jsonb_typeof(d->'name') is distinct from 'string' or length(btrim(d->>'name')) not between 1 and 240 then raise exception using errcode='22023',message='Add a campaign name up to 240 characters.'; end if;
 if jsonb_typeof(d->'closesAt') is distinct from 'string' then raise exception using errcode='22023',message='Choose the actual auction close.'; end if;
 close_at:=private.hq_auction_instant(d->>'closesAt');
 if close_at is null or extract(dow from close_at at time zone 'America/Chicago')<>0 then raise exception using errcode='22023',message='Choose the Sunday auction close in America/Chicago.'; end if;
 foreach field in array array['featuredCard','auctionPlatform','internalNotes'] loop
  if d ? field and (jsonb_typeof(d->field) is distinct from 'string' or length(d->>field)>case field when 'featuredCard' then 4000 when 'auctionPlatform' then 300 else 12000 end) then raise exception using errcode='22023',message='Check the card description, platform and notes.'; end if;
 end loop;
 if d ? 'auctionUrl' and (jsonb_typeof(d->'auctionUrl') is distinct from 'string' or length(d->>'auctionUrl')>2000 or (d->>'auctionUrl'<>'' and d->>'auctionUrl' !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$')) then raise exception using errcode='22023',message='Use an HTTPS auction URL without credentials.'; end if;
 foreach field in array array['lotUrls','assetLinks'] loop
  if d ? field then
   if jsonb_typeof(d->field) is distinct from 'array' or jsonb_array_length(d->field)>(case field when 'lotUrls' then 20 else 40 end) then raise exception using errcode='22023',message='Use up to 20 lot links and 40 asset links.'; end if;
   for item in select value from jsonb_array_elements(d->field) loop
    if jsonb_typeof(item) is distinct from 'string' or length(item#>>'{}')>2000 or item#>>'{}' !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' then raise exception using errcode='22023',message='Use HTTPS lot and asset links without credentials.'; end if;
   end loop;
  end if;
 end loop;
 if d ? 'owner' and (jsonb_typeof(d->'owner') is distinct from 'string' or not private.hq_active(w,d->>'owner')) then raise exception using errcode='22023',message='Choose an active primary owner in this workspace.'; end if;
 if d ? 'assignees' then
  if jsonb_typeof(d->'assignees') is distinct from 'array' or jsonb_array_length(d->'assignees')>50 then raise exception using errcode='22023',message='Choose up to 50 additional assignees.'; end if;
  if (select count(distinct value) from jsonb_array_elements_text(d->'assignees'))<>jsonb_array_length(d->'assignees') or d->'assignees' ? (d->>'owner') then raise exception using errcode='22023',message='List each additional assignee once, separately from the owner.'; end if;
  for item in select value from jsonb_array_elements(d->'assignees') loop
   if jsonb_typeof(item) is distinct from 'string' or not private.hq_active(w,item#>>'{}') then raise exception using errcode='22023',message='Choose active staff from this workspace.'; end if;
  end loop;
 end if;
 if d ? 'campaignBudgetCents' and d->'campaignBudgetCents'<>'null'::jsonb and (jsonb_typeof(d->'campaignBudgetCents') is distinct from 'number' or d->>'campaignBudgetCents' !~ '^\d{1,12}$') then raise exception using errcode='22023',message='Use a nonnegative campaign budget in whole cents, or leave it blank.'; end if;
end $$;
revoke all on function private.hq_validate_auction(text,jsonb,boolean) from public,anon,authenticated;

create or replace function private.hq_sync_auction_campaign() returns trigger
language plpgsql set search_path='' as $$
declare close_at timestamptz; row record; d jsonb; due text; moved boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id,0));
 if jsonb_typeof(new.data->'auction_number') is distinct from 'number' or new.data->>'auction_number' !~ '^[1-9]\d{0,8}$'
  or jsonb_typeof(new.data->'name') is distinct from 'string' or length(btrim(new.data->>'name')) not between 1 and 300
  or not exists(select 1 from public.marketing_records where workspace_id=new.workspace_id and kind='project' and id=new.data->>'projectId') then
  raise exception using errcode='22023',message='Choose a valid auction number, campaign name and parent project.';
 end if;
 if tg_op='UPDATE' and new.data->>'projectId' is distinct from old.data->>'projectId' then raise exception using errcode='22023',message='Keep this auction campaign with its project.'; end if;
 close_at:=private.hq_auction_instant(new.data->>'closesAt');
 if close_at is null or extract(dow from close_at at time zone 'America/Chicago')<>0 then raise exception using errcode='22023',message='Choose the Sunday auction close in America/Chicago.'; end if;
 for row in select id,data from public.marketing_records where workspace_id=new.workspace_id and kind='deliverable' and data->>'auctionCampaignId'=new.id and data->>'deletedAt' is null loop
  if row.data->>'projectId' is distinct from new.data->>'projectId' then raise exception using errcode='22023',message='An auction deliverable must belong to its campaign project.'; end if;
  d:=row.data||jsonb_build_object('auction_number',new.data->'auction_number','campaignReference',new.data->'name','auctionClosesAt',to_jsonb(close_at),'campaignOwner',coalesce(new.data->>'owner',''),'campaignAssignees',coalesce(new.data->'assignees','[]'::jsonb),'campaignFeaturedCard',coalesce(new.data->>'featuredCard',''),'campaignAuctionPlatform',coalesce(new.data->>'auctionPlatform',''),'campaignAuctionUrl',coalesce(new.data->>'auctionUrl',''),'campaignLotUrls',coalesce(new.data->'lotUrls','[]'::jsonb),'campaignAssetLinks',coalesce(new.data->'assetLinks','[]'::jsonb));
  -- Rename untouched generated titles while retaining independently edited titles.
  if tg_op='UPDATE' and row.data->>'title'='#'||(old.data->>'auction_number')||' '||(old.data->>'name')||' — '||(row.data->>'reminderHours')||' Hour Reminder' then
   d:=d||jsonb_build_object('title','#'||(new.data->>'auction_number')||' '||(new.data->>'name')||' — '||(row.data->>'reminderHours')||' Hour Reminder');
  end if;
  moved:=coalesce(private.hq_auction_instant(nullif(row.data->>'auctionClosesAt','')) is distinct from close_at,true);
  if moved and row.data->>'reminderHours' in ('48','24','2') then
   if exists(select 1 from jsonb_each(row.data->'publications') where value->>'status' in ('scheduled','published')) then raise exception using errcode='22023',message='Cancel confirmed schedules before changing the close. Published reminder schedules remain in history.'; end if;
   due:=to_char((close_at-make_interval(hours=>(row.data->>'reminderHours')::int)) at time zone 'America/Chicago','YYYY-MM-DD"T"HH24:MI');
   d:=d||jsonb_build_object('productionDue',due,'publishAt',due,'contentVersion',coalesce((row.data->>'contentVersion')::int,1)+1,'approval',null,'submission',null,'status',case when row.data->>'status' in ('ready','needs_review') then 'in_progress' else row.data->>'status' end);
  end if;
  if d is distinct from row.data then
   d:=d||jsonb_build_object('version',(row.data->>'version')::int+1,'updatedAt',now());
   if auth.uid() is null then
    -- Trusted migration writes have no staff JWT. Keep an explicit system audit actor.
    update public.marketing_records set data=d,updated_at=now() where workspace_id=new.workspace_id and kind='deliverable' and id=row.id;
    insert into public.hq_activity(org_id,kind,record_id,project_id,actor,action,snapshot)
     values(new.workspace_id,'deliverable',row.id,d->>'projectId','migration','auction campaign updated',d);
   else
    perform private.hq_put(new.workspace_id,'deliverable',row.id,d,'auction campaign updated');
   end if;
  end if;
 end loop;
 return new;
end $$;

-- The public wrapper remains invoker-only; this checked transaction owns all writes.
create or replace function private.hq_auction_campaign(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); old jsonb; p jsonb; d jsonb:=payload->'data'; i text:=payload->>'id';
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 select data into old from public.marketing_records where workspace_id=w and kind='auction_campaign' and id=i;
 if old is null then raise exception using errcode='22023',message='Auction campaign not found.'; end if;
 select data into p from public.marketing_records where workspace_id=w and kind='project' and id=old->>'projectId';
 if not coalesce(private.staff_role()='admin' or p->>'owner'=s or p->'members'?s or old->>'owner'=s,false) then raise exception using errcode='42501',message='Only project members, the campaign owner or an administrator can edit the shared auction campaign.'; end if;
 if p->>'status' in ('archived','completed') then raise exception using errcode='22023',message='Reopen the project before changing the campaign.'; end if;
 if coalesce(payload->>'version','') !~ '^\d{1,8}$' or (payload->>'version')::integer<>(old->>'version')::integer then raise exception using errcode='40001',message='Someone changed this campaign. Reload before saving.'; end if;
 perform private.hq_validate_auction(w,d,false);
 if exists(select 1 from public.marketing_records where workspace_id=w and kind='auction_campaign' and id<>i and (data->>'auction_number')::int=(d->>'auction_number')::int) then raise exception using errcode='22023',message='This auction number already exists. Choose an unused number.'; end if;
 d:=d||jsonb_build_object('closesAt',private.hq_auction_instant(d->>'closesAt'));
 if not exists(select 1 from jsonb_each(d) field where old->field.key is distinct from field.value) then return jsonb_build_object('id',i,'kind','auction_campaign','data',old); end if;
 return private.hq_put(w,'auction_campaign',i,old||d||jsonb_build_object('version',(old->>'version')::integer+1,'updatedAt',now(),'updatedBy',s),'auction details updated');
end $$;

create or replace function private.hq_create_auction_campaign(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); i text:=payload->>'id'; parent_id text:=payload->>'projectId'; d jsonb:=payload->'data'; budgets jsonb:=payload->'plannedBudgets'; p jsonb; old jsonb; campaign jsonb; child jsonb; result jsonb; hours integer; child_id text; due text; close_at timestamptz; refs jsonb; stamp timestamptz:=now();
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>150000 or payload-array['id','projectId','data','plannedBudgets']<>'{}'::jsonb or i is null or i !~ '^[a-zA-Z0-9_-]{1,150}$' then raise exception using errcode='22023',message='Check the campaign request.'; end if;
 select data into p from public.marketing_records where workspace_id=w and kind='project' and id=parent_id;
 -- Resolve the permanent parent through the already-migrated MJ campaign, never a generated UUID or mutable project title.
 if p is null or p->>'migratedToProjectId' is not null or p->>'type'<>'weekly_auction' or not exists(select 1 from public.marketing_records where workspace_id=w and kind='auction_campaign' and data->>'projectId'=parent_id and data->>'sourceProjectId'='mj-consignment-video-2026-09-23') then raise exception using errcode='22023',message='Add auction campaigns inside the existing Collect Weekly Auctions project.'; end if;
 if not coalesce(private.staff_role()='admin' or p->>'owner'=s or p->'members'?s,false) then raise exception using errcode='42501',message='Only staff assigned to Collect Weekly Auctions or an administrator can add a campaign.'; end if;
 if p->>'status' in ('archived','completed') then raise exception using errcode='22023',message='Reopen the parent project before adding an auction.'; end if;
 select data into old from public.marketing_records where workspace_id=w and kind='auction_campaign' and id=i;
 if old is not null then
  if old->'creationRequest' is distinct from payload then raise exception using errcode='40001',message='This creation request was already used. Reload before creating another campaign.'; end if;
  return jsonb_build_object('id',i,'kind','auction_campaign','data',old,'existing',true);
 end if;
 perform private.hq_validate_auction(w,d,true);
 if jsonb_typeof(budgets) is distinct from 'object' or budgets-array['48','24','2']<>'{}'::jsonb or not budgets ?& array['48','24','2'] then raise exception using errcode='22023',message='Check the three planned reminder budgets.'; end if;
 foreach hours in array array[48,24,2] loop
  if budgets->(hours::text)<>'null'::jsonb and (jsonb_typeof(budgets->(hours::text)) is distinct from 'number' or budgets->>(hours::text) !~ '^\d{1,12}$') then raise exception using errcode='22023',message='Use nonnegative whole cents for reminder budgets, or leave them blank.'; end if;
 end loop;
 if exists(select 1 from public.marketing_records where workspace_id=w and kind='auction_campaign' and (data->>'auction_number')::int=(d->>'auction_number')::int) then
  raise exception using errcode='22023',message='Auction #'||(d->>'auction_number')||' already exists. The next available number is #'||(select coalesce(max((data->>'auction_number')::integer),0)+1 from public.marketing_records where workspace_id=w and kind='auction_campaign')||'.';
 end if;
 close_at:=private.hq_auction_instant(d->>'closesAt');
 campaign:=d||jsonb_build_object('projectId',parent_id,'closesAt',close_at,'creationRequest',payload,'version',1,'createdAt',stamp,'updatedAt',stamp,'createdBy',s,'updatedBy',s);
 result:=private.hq_put(w,'auction_campaign',i,campaign,'auction campaign created');
 select coalesce(jsonb_agg(distinct value),'[]'::jsonb) into refs from jsonb_array_elements((d->'assetLinks')||(d->'lotUrls'));
 foreach hours in array array[48,24,2] loop
  child_id:=i||'-'||hours||'h';
  -- A collision is an error; never overwrite an unrelated or independently edited record.
  if exists(select 1 from public.marketing_records where workspace_id=w and kind='deliverable' and (id=child_id or (data->>'auctionCampaignId'=i and data->>'reminderHours'=hours::text))) then raise exception using errcode='22023',message='A reminder already exists for this campaign. No duplicate was created.'; end if;
  due:=to_char((close_at-make_interval(hours=>hours)) at time zone 'America/Chicago','YYYY-MM-DD"T"HH24:MI');
  child:=jsonb_build_object('title','#'||(d->>'auction_number')||' '||(d->>'name')||' — '||hours||' Hour Reminder','instructions','Prepare the '||hours||'-hour reminder for '||(d->>'name')||'. '||coalesce(d->>'featuredCard',''),'owner',d->'owner','contributors',d->'assignees','publisher',d->'owner','projectId',parent_id,'approver','','productionDue',due,'publishAt',due,'format','Vertical video','caption','','destinationUrl',coalesce(nullif(d->'lotUrls'->>0,''),d->>'auctionUrl',''),'effort','standard','estimatedHours',null,'publishing',true,'platforms',jsonb_build_array('facebook','instagram'),'blocked',false,'blockedReason','','blockedBy','','assets','[]'::jsonb,'references',refs,'assetRoles','{}'::jsonb,'linkRoles',coalesce((select jsonb_object_agg(value,'reference'::text) from jsonb_array_elements_text(refs)),'{}'::jsonb),'evidence','{}'::jsonb,'requiresFinalFile',true,'requiresCaption',true,'promotionMode','organic','promotionChannel','','promotionCents',0);
  perform private.hq_validate(w,'deliverable',child);
  child:=child||jsonb_build_object('auctionCampaignId',i,'auction_number',d->'auction_number','campaignReference',d->'name','auctionClosesAt',close_at,'reminderHours',hours,'timezone','America/Chicago','campaignOwner',d->'owner','campaignAssignees',d->'assignees','campaignFeaturedCard',d->'featuredCard','campaignAuctionPlatform',d->'auctionPlatform','campaignAuctionUrl',d->'auctionUrl','campaignLotUrls',d->'lotUrls','campaignAssetLinks',d->'assetLinks','status','to_do','priority','normal','notes',d->'internalNotes','plannedBudgetCents',budgets->(hours::text),'actualSpendCents',null,'approval',null,'submission',null,'publications',jsonb_build_object('facebook',jsonb_build_object('status','planned'),'instagram',jsonb_build_object('status','planned')),'version',1,'contentVersion',1,'createdAt',stamp,'updatedAt',stamp,'createdBy',s);
  perform private.hq_put(w,'deliverable',child_id,child,'auction reminder created');
 end loop;
 return result||jsonb_build_object('existing',false);
end $$;
revoke all on function private.hq_create_auction_campaign(jsonb) from public,anon,authenticated;
grant execute on function private.hq_create_auction_campaign(jsonb) to authenticated;
create or replace function public.hub_create_auction_campaign(p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.hq_create_auction_campaign(p_payload) $$;
revoke all on function public.hub_create_auction_campaign(jsonb) from public,anon,authenticated;
grant execute on function public.hub_create_auction_campaign(jsonb) to authenticated;

-- Compare arrays exactly so removing inherited links or assignees is an actual edit.
create or replace function public.hub_auction_deliverable(p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w text; old jsonb; comparison jsonb; field text; result jsonb; details jsonb:=p_payload->'data'; metadata jsonb:=p_payload->'metadata';
begin
 -- Use the existing staff + agreement gate, even for a no-op save.
 perform public.hub_hq('context','{}'::jsonb);
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>100000
  or jsonb_typeof(details) is distinct from 'object' or jsonb_typeof(metadata) is distinct from 'object'
  or metadata-array['priority','notes']<>'{}'::jsonb
  or coalesce(metadata->>'priority','') not in ('low','normal','high','urgent')
  or jsonb_typeof(metadata->'notes') is distinct from 'string' or length(metadata->>'notes')>12000 then
  raise exception using errcode='22023',message='Check deliverable details, priority and notes.';
 end if;
 select workspace_id into w from public.marketing_records where kind='deliverable' and id=p_payload->>'id';
 if w is null then raise exception using errcode='22023',message='Deliverable not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 select data into old from public.marketing_records where workspace_id=w and kind='deliverable' and id=p_payload->>'id';
 if old->>'workflow'='task' or old->>'deletedAt' is not null then
  raise exception using errcode='22023',message='Use the task editor or restore this deliverable first.';
 end if;
 if coalesce(p_payload->>'version','') !~ '^\d{1,8}$' or (p_payload->>'version')::integer<>(old->>'version')::integer then
  raise exception using errcode='40001',message='Someone changed this deliverable. Reload before saving.';
 end if;
 result:=jsonb_build_object('id',p_payload->>'id','kind','deliverable','data',old);
 -- Metadata-only changes retain the current content approval and platform confirmations.
 -- The browser edits Chicago wall times, including imported ISO-offset records.
 comparison:=old;
 foreach field in array array['productionDue','publishAt'] loop
  if old->>field ~ '(Z|[+-]\d{2}:?\d{2})$' then
   comparison:=jsonb_set(comparison,array[field],to_jsonb(to_char((old->>field)::timestamptz at time zone 'America/Chicago','YYYY-MM-DD"T"HH24:MI')));
  end if;
 end loop;
 if exists(select 1 from jsonb_each(details) field where comparison->field.key is distinct from field.value) then
  result:=public.hub_hq('save-deliverable',p_payload-array['metadata','budget']);
 end if;
 if coalesce(old->>'priority','normal') is distinct from metadata->>'priority'
  or coalesce(old->>'notes','') is distinct from metadata->>'notes' then
  result:=public.hub_project_tasks('task-metadata',jsonb_build_object('id',p_payload->>'id',
   'version',result->'data'->'version','data',metadata));
 end if;
 if p_payload ? 'budget' then result:=public.hub_deliverable_budget(jsonb_build_object('id',p_payload->>'id','version',result->'data'->'version','data',p_payload->'budget')); end if;
 return result;
end $$;

-- Existing campaign membership is derived from its preserved deliverables once.
-- No reminder, parent, date, budget, publication or assignment is replaced.
do $$
declare c record; sample jsonb; enriched jsonb;
begin
 for c in select workspace_id,id,data from public.marketing_records where kind='auction_campaign' and not data ? 'owner' loop
  perform pg_advisory_xact_lock(hashtextextended(c.workspace_id,0));
  select data into sample from public.marketing_records where workspace_id=c.workspace_id and kind='deliverable' and data->>'auctionCampaignId'=c.id and data->>'deletedAt' is null order by id limit 1;
  if sample is null then continue; end if;
  enriched:=jsonb_build_object('owner',sample->'owner','assignees',coalesce(sample->'contributors','[]'::jsonb),'featuredCard','','auctionPlatform','','auctionUrl','','lotUrls','[]'::jsonb,'assetLinks','[]'::jsonb,'internalNotes','','campaignBudgetCents',null)||c.data;
  enriched:=enriched||jsonb_build_object('version',(c.data->>'version')::int+1,'updatedAt',now());
  update public.marketing_records set data=enriched,updated_at=now() where workspace_id=c.workspace_id and kind='auction_campaign' and id=c.id;
  insert into public.hq_activity(org_id,kind,record_id,project_id,actor,action,snapshot) values(c.workspace_id,'auction_campaign',c.id,enriched->>'projectId','migration','auction campaign membership initialized',enriched);
 end loop;
end $$;
commit;
