begin;
-- Reuse canonical records and checked transactions. No project or deliverable is created.
-- Status participation is evaluated against the CURRENT staff roster and assignments.
create or replace function private.hq_approval_actor(d jsonb,p jsonb,s text) returns boolean
language sql stable set search_path='' as $$
 select private.hq_active(private.workspace(),s) and coalesce(
  d->>'owner'=s or d->>'publisher'=s or d->'contributors'?s or p->>'owner'=s or p->'members'?s
  or (coalesce(d->>'projectId','')='' and d->>'approver'=s)
  or exists(select 1 from private.staff_access where org_id=private.workspace() and id=s and active and role='admin'),false)
$$;
revoke all on function private.hq_approval_actor(jsonb,jsonb,text) from public,anon,authenticated;
create or replace function private.hq_current_approval(d jsonb,p jsonb) returns boolean language sql stable set search_path='' as $$
 select coalesce(private.hq_approval_actor(d,p,d->'approval'->>'by')
 and d->'approval'->'contentVersion'=d->'contentVersion' and d->'approval' ? 'approvedVersion' and jsonb_typeof(d->'approval'->'package')='object'
 and (coalesce(d->>'projectId','')='' or (d->'approval'->'projectVersion'=p->'version' and p->>'status'='active' and (d->>'promotionMode'<>'paid' or p->'budget'<>'null'::jsonb))),false)
$$;
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
  if p_action='review' and old->>'status'<>'needs_review' then raise exception using errcode='42501',message='Submit the current version for review first.'; end if;
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
   if not private.hq_can_work(old,p,s) then raise exception using errcode='42501',message='Only involved staff or an administrator can approve.'; end if;
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
   d:=d||jsonb_build_object('approval',jsonb_build_object('by',s,'admin',adm,'at',now(),'projectVersion',p->'version','budgetVersion',p->'budget'->'version','reviewedVersion',old->'version','approvedVersion',version,'contentVersion',old->'contentVersion','comment',comment_text,'package',private.hq_package(old)));
  elsif next_status='done' then
   if old->'blocked'='true'::jsonb or not private.hq_current_approval(old,p) then raise exception using errcode='22023',message='Current approval is required before Done.'; end if;
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
  if not private.hq_can_work(old,p,s) then raise exception using errcode='42501',message='Only involved staff or an administrator can record publishing.'; end if;
  dest:=p_payload->>'platform'; next_status:=p_payload->>'status'; entry:=old->'publications'->dest;
  if old->'publishing'<>'true'::jsonb or entry is null or coalesce(next_status,'') not in ('planned','scheduled','published') then raise exception using errcode='22023',message='Choose a destination on this publishing deliverable.'; end if;
  if entry->>'status'='published' then raise exception using errcode='22023',message='Published facts are permanent. Add a comment for corrections or create follow-up work.'; end if;
  if p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception using errcode='22023',message='Explicitly confirm the action on the actual platform.'; end if;
  if next_status<>'planned' and (old->>'status'<>'ready' or old->'blocked'='true'::jsonb or not private.hq_current_approval(old,p)) then raise exception using errcode='22023',message='Current approval and unblocked Ready work are required.'; end if;
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

create or replace function private.hq_task(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 w text:=private.require_staff(); s text:=private.hq_staff_id();
 i text:=p_payload->>'id'; d jsonb:=p_payload->'data'; old jsonb; p jsonb;
 managed boolean; assigned boolean; v integer; next_status text; member text;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>100000 or i is null or i !~ '^[a-zA-Z0-9_-]{1,180}$' then raise exception using errcode='22023',message='Check task fields.'; end if;
 if p_action not in ('save-task','task-status','task-delete','task-restore','task-metadata') then raise exception using errcode='22023',message='Unknown task action.'; end if;
 select data into old from public.marketing_records where workspace_id=w and kind='deliverable' and id=i;
 if coalesce(p_payload->>'version','') !~ '^\d{1,8}$' or (p_payload->>'version')::int<>coalesce((old->>'version')::int,0) then raise exception using errcode='40001',message='Someone changed this record. Reload before saving.'; end if;
 if old is null and p_action<>'save-task' then raise exception using errcode='22023',message='Deliverable not found.'; end if;
 select data into p from public.marketing_records where workspace_id=w and kind='project' and id=coalesce(old->>'projectId',d->>'projectId');
 managed:=coalesce(private.staff_role()='admin' or p->>'owner'=s or (coalesce(old->>'projectId','')='' and old->>'approver'=s),false);
 assigned:=coalesce(old->>'owner'=s or old->'contributors'?s or old->>'publisher'=s or p->'members'?s,false);
 if old->>'deletedAt' is not null and p_action<>'task-restore' then raise exception using errcode='22023',message='Restore this deliverable before changing it.'; end if;
 if p_action in ('save-task','task-metadata','task-delete','task-restore') and not managed then
  -- Existing project members may add their own work, but cannot assign other people.
  if not (p_action='save-task' and old is null and coalesce(p->'members'?s,false) and d->'assignees'=jsonb_build_array(s)) then
   raise exception using errcode='42501',message='The project owner or an administrator manages assignments and schedules.';
  end if;
 end if;
 if p_action not in ('task-delete','task-restore') and p->>'status' in ('completed','archived') then raise exception using errcode='22023',message='Reopen the project before changing work.'; end if;
 if p_action='save-task' then
  if p is null or (old is not null and old->>'workflow' is distinct from 'task') then raise exception using errcode='22023',message='Choose a project task. Publishing work keeps its existing workflow.'; end if;
  if jsonb_typeof(d) is distinct from 'object' or d-array['title','instructions','projectId','assignees','productionDue','endAt','priority','notes']<>'{}'::jsonb or d->>'projectId' is distinct from coalesce(old->>'projectId',d->>'projectId') then raise exception using errcode='22023',message='Check task fields; keep work in its project.'; end if;
  if jsonb_typeof(d->'title') is distinct from 'string' or length(btrim(d->>'title')) not between 1 and 300 or jsonb_typeof(d->'instructions') is distinct from 'string' or length(d->>'instructions')>12000 then raise exception using errcode='22023',message='Add a title and valid description.'; end if;
  if jsonb_typeof(d->'assignees') is distinct from 'array' or jsonb_array_length(d->'assignees') not between 1 and 50 then raise exception using errcode='22023',message='Assign at least one staff member.'; end if;
  if exists(select 1 from jsonb_array_elements(d->'assignees') where jsonb_typeof(value)<>'string') then raise exception using errcode='22023',message='Choose staff IDs from this workspace.'; end if;
  if (select count(distinct value) from jsonb_array_elements_text(d->'assignees'))<>jsonb_array_length(d->'assignees') then raise exception using errcode='22023',message='Choose each assignee once.'; end if;
  for member in select jsonb_array_elements_text(d->'assignees') loop
   if not private.hq_active(w,member) then raise exception using errcode='22023',message='Choose active staff from this workspace.'; end if;
  end loop;
  if jsonb_typeof(d->'productionDue') is distinct from 'string' or jsonb_typeof(d->'endAt') is distinct from 'string' then raise exception using errcode='22023',message='Check the schedule.'; end if;
  if d->>'productionDue'<>'' then perform private.consignment_time(d->>'productionDue'); end if;
  if d->>'endAt'<>'' then
   perform private.consignment_time(d->>'endAt');
   if d->>'productionDue'='' or d->>'endAt'<=d->>'productionDue' then raise exception using errcode='22023',message='The end must follow the due/start time.'; end if;
  end if;
  d:=coalesce(old,jsonb_build_object('workflow','task','status','to_do','waiting',false,'publishing',false,'platforms','[]'::jsonb,'publications','{}'::jsonb,'publishAt','','publisher','','approver','','format','','caption','','destinationUrl','','effort','standard','estimatedHours',null,'blocked',false,'blockedReason','','blockedBy','','assets','[]'::jsonb,'references','[]'::jsonb,'assetRoles','{}'::jsonb,'linkRoles','{}'::jsonb,'evidence','{}'::jsonb,'requiresFinalFile',false,'requiresCaption',false,'promotionMode','organic','promotionChannel','','promotionCents',0,'approval',null,'submission',null,'contentVersion',1))
   ||(d-'assignees')||jsonb_build_object('owner',d->'assignees'->>0,'contributors',(d->'assignees')-0);
 elsif p_action='task-status' then
  if old->>'workflow' is distinct from 'task' or not (managed or assigned) then raise exception using errcode='42501',message='Only assigned staff or the project manager can complete this task.'; end if;
  next_status:=p_payload->>'status';
  if next_status is null or next_status not in ('not_started','in_progress','waiting','complete') then raise exception using errcode='22023',message='Choose a task status.'; end if;
  d:=old||jsonb_build_object('status',case next_status when 'not_started' then 'to_do' when 'complete' then 'done' else 'in_progress' end,'waiting',next_status='waiting');
 elsif p_action='task-metadata' then
  if jsonb_typeof(d) is distinct from 'object' or d-array['priority','notes']<>'{}'::jsonb then raise exception using errcode='22023',message='Only priority and notes can be edited here.'; end if;
  d:=old||d;
 elsif p_action='task-delete' then
  if exists(select 1 from jsonb_each(old->'publications') where value->>'status' in ('scheduled','published')) then raise exception using errcode='22023',message='Confirmed publishing history cannot be removed. Cancel platform scheduling first.'; end if;
  d:=old||jsonb_build_object('deletedAt',now(),'deletedBy',s);
 else
  if old->>'deletedAt' is null then raise exception using errcode='22023',message='This deliverable is not deleted.'; end if;
  d:=old-array['deletedAt','deletedBy'];
 end if;
 if p_action in ('save-task','task-metadata') and (coalesce(d->>'priority','') not in ('low','normal','high','urgent') or jsonb_typeof(d->'notes') is distinct from 'string' or length(d->>'notes')>12000) then raise exception using errcode='22023',message='Choose a priority and notes up to 12000 characters.'; end if;
 v:=coalesce((old->>'version')::int,0)+1;
 d:=d||jsonb_build_object('version',v,'createdBy',coalesce(old->>'createdBy',s),'createdAt',coalesce(old->'createdAt',to_jsonb(now())),'updatedAt',now());
 -- Completed time is server-owned, idempotent, and cleared when reopened.
 if d->>'status'='done' and old->>'status' is distinct from 'done' then d:=d||jsonb_build_object('completedAt',now()); elsif d->>'status'<>'done' then d:=d-'completedAt'; end if;
 return private.hq_put(w,'deliverable',i,d,p_action);
end $$;
create or replace function private.hq_task_guard() returns trigger language plpgsql set search_path='' as $$
declare s text:=private.hq_staff_id(); p jsonb; manager boolean; allowed text[]:=array['status','waiting','version','updatedAt','completedAt','plannedBudgetCents','actualSpendCents','budgetUpdatedBy','budgetUpdatedAt'];
begin
 if new.kind='project' then
  -- Grandfather existing drafts without silently assigning responsibility.
  if coalesce(new.data->>'owner','')='' and (tg_op='INSERT' or coalesce(old.data->>'owner','')<>'') then raise exception using errcode='22023',message='Choose one primary project owner.'; end if;
  return new;
 end if;
 if tg_op='INSERT' or old.kind<>'deliverable' then return new; end if;
 select data into p from public.marketing_records where workspace_id=old.workspace_id and kind='project' and id=old.data->>'projectId';
 manager:=coalesce(private.staff_role()='admin' or p->>'owner'=s or (coalesce(old.data->>'projectId','')='' and old.data->>'approver'=s),false);
 if old.data->>'deletedAt' is not null then
  if not manager or new.data ? 'deletedAt' or (new.data-array['deletedAt','deletedBy','version','updatedAt','completedAt']) is distinct from (old.data-array['deletedAt','deletedBy','version','updatedAt','completedAt']) then raise exception using errcode='42501',message='Restore the deleted deliverable before editing.'; end if;
 end if;
 if old.data->>'workflow'='task' then
  if new.data->>'workflow' is distinct from 'task' or new.data->>'projectId' is distinct from old.data->>'projectId' or new.data->'publishing' is distinct from 'false'::jsonb or new.data->'platforms' is distinct from '[]'::jsonb or new.data->>'status' not in ('to_do','in_progress','done') then raise exception using errcode='22023',message='Project tasks keep their own status workflow.'; end if;
  if not manager and (not private.hq_can_work(old.data,p,s) or new.data-allowed is distinct from old.data-allowed) then raise exception using errcode='42501',message='Assigned staff can change task status; the manager edits task details.'; end if;
  if coalesce(new.data->>'endAt','')<>'' and (coalesce(new.data->>'productionDue','')='' or new.data->>'endAt'<=new.data->>'productionDue') then raise exception using errcode='22023',message='The end must follow the due/start time.'; end if;
 end if;
 if new.data->>'status'='done' and old.data->>'status' is distinct from 'done' then new.data:=new.data||jsonb_build_object('completedAt',now()); elsif new.data->>'status'<>'done' then new.data:=new.data-'completedAt'; end if;
 return new;
end $$;

-- Budget values are nullable, bounded integer cents. A blank actual is not a zero.
create or replace function private.hq_deliverable_budget(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); i text:=payload->>'id'; old jsonb; p jsonb; d jsonb:=payload->'data'; field text;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 select data into old from public.marketing_records where workspace_id=w and kind='deliverable' and id=i;
 if old is null or old->>'deletedAt' is not null then raise exception using errcode='22023',message='Choose an active deliverable.'; end if;
 select data into p from public.marketing_records where workspace_id=w and kind='project' and id=old->>'projectId';
 if not private.hq_can_work(old,p,s) then raise exception using errcode='42501',message='Only involved staff or an administrator can edit this budget.'; end if;
 if coalesce(payload->>'version','') !~ '^\d{1,8}$' or (payload->>'version')::integer<>(old->>'version')::integer then raise exception using errcode='40001',message='Someone changed this deliverable. Reload before saving.'; end if;
 if jsonb_typeof(d) is distinct from 'object' or d-array['plannedBudgetCents','actualSpendCents']<>'{}'::jsonb then raise exception using errcode='22023',message='Check the budget fields.'; end if;
 foreach field in array array['plannedBudgetCents','actualSpendCents'] loop
  if not d ? field or (d->field<>'null'::jsonb and (jsonb_typeof(d->field) is distinct from 'number' or d->>field !~ '^\d{1,12}$')) then raise exception using errcode='22023',message='Use nonnegative whole cents, or leave the amount blank.'; end if;
 end loop;
 if coalesce(old->'plannedBudgetCents','null')=d->'plannedBudgetCents' and coalesce(old->'actualSpendCents','null')=d->'actualSpendCents' then return jsonb_build_object('id',i,'data',old); end if;
 return private.hq_put(w,'deliverable',i,old||d||jsonb_build_object('budgetUpdatedBy',s,'budgetUpdatedAt',now(),'version',(old->>'version')::integer+1,'updatedAt',now()),'deliverable budget updated');
end $$;
revoke all on function private.hq_deliverable_budget(jsonb) from public,anon,authenticated;
grant execute on function private.hq_deliverable_budget(jsonb) to authenticated;
create or replace function public.hub_deliverable_budget(p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.hq_deliverable_budget(p_payload) $$;
revoke all on function public.hub_deliverable_budget(jsonb) from public,anon,authenticated;
grant execute on function public.hub_deliverable_budget(jsonb) to authenticated;

-- Canonical auction metadata lives under its existing parent, independently of project budgets.
-- Deliverable mirrors support existing calendar/readers without manual calendar copies.
create or replace function private.hq_auction_instant(value text) returns timestamptz
language plpgsql set search_path='' as $$
begin
 if value is null or value='' then return null; end if;
 if value ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then return value::timestamptz; end if;
 return private.consignment_time(value);
end $$;
revoke all on function private.hq_auction_instant(text) from public,anon,authenticated;
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
  d:=row.data||jsonb_build_object('auction_number',new.data->'auction_number','campaignReference',new.data->'name','auctionClosesAt',to_jsonb(close_at));
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
revoke all on function private.hq_sync_auction_campaign() from public,anon,authenticated;
drop trigger if exists hq_sync_auction_campaign on public.marketing_records;
create trigger hq_sync_auction_campaign after insert or update on public.marketing_records for each row when(new.kind='auction_campaign') execute function private.hq_sync_auction_campaign();

create or replace function private.hq_auction_parent_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.data->>'auctionCampaignId' is not null and
  (new.data->>'projectId' is distinct from old.data->>'projectId' or new.data->>'auctionCampaignId' is distinct from old.data->>'auctionCampaignId') then
  raise exception using errcode='22023',message='Keep auction deliverables with their campaign and parent project.';
 end if;
 return new;
end $$;
revoke all on function private.hq_auction_parent_guard() from public,anon,authenticated;
drop trigger if exists hq_auction_parent_guard on public.marketing_records;
create trigger hq_auction_parent_guard before update on public.marketing_records for each row when(old.kind='deliverable') execute function private.hq_auction_parent_guard();

create or replace function private.hq_auction_campaign(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); old jsonb; p jsonb; d jsonb:=payload->'data'; i text:=payload->>'id';
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 select data into old from public.marketing_records where workspace_id=w and kind='auction_campaign' and id=i;
 if old is null then raise exception using errcode='22023',message='Auction campaign not found.'; end if;
 select data into p from public.marketing_records where workspace_id=w and kind='project' and id=old->>'projectId';
 if not coalesce(private.staff_role()='admin' or p->>'owner'=s or p->'members'?s,false) then raise exception using errcode='42501',message='Only project members or an administrator can edit the shared auction campaign.'; end if;
 if p->>'status' in ('archived','completed') then raise exception using errcode='22023',message='Reopen the project before changing the campaign.'; end if;
 if coalesce(payload->>'version','') !~ '^\d{1,8}$' or (payload->>'version')::integer<>(old->>'version')::integer then raise exception using errcode='40001',message='Someone changed this campaign. Reload before saving.'; end if;
 if jsonb_typeof(d) is distinct from 'object' or octet_length(payload::text)>10000 or d-array['name','auction_number','closesAt']<>'{}'::jsonb
  or not d ?& array['name','auction_number','closesAt'] then raise exception using errcode='22023',message='Check the campaign fields.'; end if;
 d:=d||jsonb_build_object('closesAt',private.hq_auction_instant(d->>'closesAt'));
 if old @> d then return jsonb_build_object('id',i,'kind','auction_campaign','data',old); end if;
 return private.hq_put(w,'auction_campaign',i,old||d||jsonb_build_object('version',(old->>'version')::integer+1,'updatedAt',now(),'updatedBy',s),'auction details updated');
end $$;
revoke all on function private.hq_auction_campaign(jsonb) from public,anon,authenticated;
grant execute on function private.hq_auction_campaign(jsonb) to authenticated;
create or replace function public.hub_auction_campaign(p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.hq_auction_campaign(p_payload) $$;
revoke all on function public.hub_auction_campaign(jsonb) from public,anon,authenticated;
grant execute on function public.hub_auction_campaign(jsonb) to authenticated;

-- The migrated campaign is discovered from its preserved source reference, not a generated parent ID.
-- ON CONFLICT and the relationship marker preserve later edits when this migration is replayed.
do $$
declare source_id text:='mj-consignment-video-2026-09-23'; parent record; sample jsonb;
begin
 for parent in select distinct workspace_id,data->>'projectId' project_id from public.marketing_records where kind='deliverable' and data->>'sourceProjectId'=source_id loop
  perform pg_advisory_xact_lock(hashtextextended(parent.workspace_id,0));
  if not exists(select 1 from public.marketing_records where workspace_id=parent.workspace_id and kind='project' and id=parent.project_id and data->>'migratedToProjectId' is null) then raise exception 'Existing parent project was not found.'; end if;
  select data into sample from public.marketing_records where workspace_id=parent.workspace_id and kind='deliverable' and data->>'sourceProjectId'=source_id and data->>'projectId'=parent.project_id order by id limit 1;
  if exists(select 1 from public.marketing_records where workspace_id=parent.workspace_id and kind='auction_campaign' and id=source_id and data->>'projectId' is distinct from parent.project_id) then raise exception 'Auction campaign parent conflicts with existing work.'; end if;
  insert into public.marketing_records(workspace_id,kind,id,data) values(parent.workspace_id,'auction_campaign',source_id,jsonb_build_object('name',sample->>'campaignReference','auction_number',245,'closesAt',private.hq_auction_instant(sample->>'auctionClosesAt'),'projectId',parent.project_id,'sourceProjectId',source_id,'version',1,'createdAt',now(),'updatedAt',now())) on conflict do nothing;
  update public.marketing_records set data=data||jsonb_build_object('auctionCampaignId',source_id),updated_at=now() where workspace_id=parent.workspace_id and kind='deliverable' and data->>'sourceProjectId'=source_id and data->>'projectId'=parent.project_id and data->>'auctionCampaignId' is null;
  update public.marketing_records set data=data where workspace_id=parent.workspace_id and kind='auction_campaign' and id=source_id;
 end loop;
end $$;

-- Inline edits save content, metadata and budget in the same transaction.
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
 if not comparison @> details then
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

commit;
