begin;
-- Match the existing media migration's bounded lock acquisition. Trigger DDL
-- takes dependency locks on auth.users as well as marketing_records. Acquire
-- both together so active authenticated requests cannot form a lock-order cycle.
do $$
declare attempt integer;
begin
 for attempt in 1..40 loop
  begin
   lock table auth.users, public.marketing_records in access exclusive mode nowait;
   return;
  exception when lock_not_available then
   if attempt=40 then raise; end if;
  end;
  perform pg_sleep(0.05);
 end loop;
end $$;
-- Retain canonical rows and all related history. No backfill or physical deletes.
-- Like the existing checked RPCs, identity and organization come from staff_access.
create or replace function private.hq_delete(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 w text:=private.require_staff(); s text:=private.hq_staff_id();
 k text; i text:=p_payload->>'id'; old jsonb; d jsonb; attached bigint;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in before deleting work.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if p_action not in ('delete-project','delete-deliverable') or p_action is null
  or jsonb_typeof(p_payload) is distinct from 'object'
  or p_payload-array['id','version','confirmed']<>'{}'::jsonb
  or coalesce(i,'') !~ '^[a-zA-Z0-9_-]{1,180}$'
  or coalesce(p_payload->>'version','') !~ '^[1-9]\d{0,7}$'
  or p_payload->'confirmed' is distinct from 'true'::jsonb then
  raise exception using errcode='22023',message='Confirm the named item before deleting it.';
 end if;
 k:=case p_action when 'delete-project' then 'project' else 'deliverable' end;
 select data into old from public.marketing_records where workspace_id=w and kind=k and id=i for update;
 if old is null then raise exception using errcode='22023',message='This item was not found in your workspace. Reload the saved records.'; end if;
 if private.staff_role()<>'admin' and not coalesce(old->>'owner'=s or (coalesce(old->>'owner','')='' and old->>'createdBy'=s),false) then
  raise exception using errcode='42501',message='Only the item owner or a workspace administrator can delete it. Ask the owner or an administrator for help.';
 end if;
 -- Safe retry after a lost response: preserve the first actor, time and audit event.
 if old->>'deletedAt' is not null then return jsonb_build_object('id',i,'kind',k,'data',old); end if;
 if (p_payload->>'version')::int is distinct from (old->>'version')::int then
  raise exception using errcode='40001',message='This item changed. Reload the saved records, review its current name and details, then confirm deletion again.';
 end if;
 if k='project' then
  select count(*) into attached from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'projectId'=i and data->>'deletedAt' is null;
  if attached>0 then raise exception using errcode='23514',message=format('This project has %s attached deliverable(s). Delete each deliverable individually or move it to another project before deleting this project.',attached); end if;
 end if;
 d:=old||jsonb_build_object('deletedAt',now(),'deletedBy',s,'version',(old->>'version')::int+1,'updatedAt',now());
 update public.marketing_records set data=d,updated_at=now() where workspace_id=w and kind=k and id=i;
 perform private.hq_log(w,k,i,d,p_action);
 return jsonb_build_object('id',i,'kind',k,'data',d);
end $$;
create or replace function public.hub_hq_delete(p_action text,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.hq_delete(p_action,p_payload)$$;
revoke all on function private.hq_delete(text,jsonb),public.hub_hq_delete(text,jsonb) from public,anon,authenticated;
grant execute on function private.hq_delete(text,jsonb),public.hub_hq_delete(text,jsonb) to authenticated;

-- All writers use the workspace lock. These checks also cover old RPCs, task
-- restoration and a concurrent insertion/reassignment after project deletion.
create or replace function private.hq_deletion_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare s text:=private.hq_staff_id(); parent jsonb;
begin
 if tg_op='DELETE' then
  if old.kind in ('project','deliverable') then raise exception using errcode='23514',message='Use the checked Delete action; records and history must be retained.'; end if;
  return old;
 end if;
 if new.kind not in ('project','deliverable','auction_campaign') then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id,0));
 if tg_op='INSERT' and new.data->>'deletedAt' is not null and exists(select 1 from public.marketing_records where workspace_id=new.workspace_id and kind=new.kind and id=new.id and data->>'deletedAt' is not null) then
  raise exception using errcode='22023',message='This item is deleted and read-only. Reload the saved records.';
 end if;
 if tg_op='UPDATE' and old.data->>'deletedAt' is not null then
  -- Preserve the existing manager/admin recovery action for deliverables only.
  if new.kind<>'deliverable' or new.data ? 'deletedAt'
   or new.data-array['deletedAt','deletedBy','version','updatedAt','completedAt'] is distinct from old.data-array['deletedAt','deletedBy','version','updatedAt','completedAt'] then
   raise exception using errcode='22023',message='This item is deleted and read-only. Reload the saved records.';
  end if;
 end if;
 if new.kind in ('deliverable','auction_campaign') and new.data->>'deletedAt' is null and coalesce(new.data->>'projectId','')<>'' then
  select data into parent from public.marketing_records where workspace_id=new.workspace_id and kind='project' and id=new.data->>'projectId';
  if parent->>'deletedAt' is not null then raise exception using errcode='23514',message='This project is deleted. Choose another project before adding, moving or restoring work.'; end if;
 end if;
 if new.kind in ('project','deliverable') and new.data->>'deletedAt' is not null then
  if tg_op='INSERT' or auth.uid() is null or new.workspace_id is distinct from private.require_staff()
   or not coalesce(private.staff_role()='admin' or old.data->>'owner'=s or (coalesce(old.data->>'owner','')='' and old.data->>'createdBy'=s),false)
   or new.data-array['deletedAt','deletedBy','version','updatedAt'] is distinct from old.data-array['deletedAt','deletedBy','version','updatedAt'] then
   raise exception using errcode='42501',message='Only the item owner or a workspace administrator can delete it.';
  end if;
  if new.kind='project' and exists(select 1 from public.marketing_records where workspace_id=new.workspace_id and kind='deliverable' and data->>'projectId'=new.id and data->>'deletedAt' is null) then
   raise exception using errcode='23514',message='Delete each attached deliverable individually or move it to another project first.';
  end if;
  new.data:=new.data||jsonb_build_object('deletedAt',now(),'deletedBy',s);
 end if;
 return new;
end $$;
revoke all on function private.hq_deletion_guard() from public,anon,authenticated;
drop trigger if exists hq_00_deletion_guard on public.marketing_records;
create trigger hq_00_deletion_guard before insert or update or delete on public.marketing_records for each row execute function private.hq_deletion_guard();

create or replace function private.hq_resolve_deleted_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.data->>'deletedAt' is not null then
  update public.hq_notifications set resolved_at=coalesce(resolved_at,now())
   where org_id=new.workspace_id and kind=new.kind and record_id=new.id and resolved_at is null;
 end if;
 return new;
end $$;
revoke all on function private.hq_resolve_deleted_notifications() from public,anon,authenticated;
drop trigger if exists hq_resolve_deleted_notifications on public.marketing_records;
create trigger hq_resolve_deleted_notifications after update on public.marketing_records for each row when(new.kind in ('project','deliverable')) execute function private.hq_resolve_deleted_notifications();

-- Retain existing task edit/recovery checks and workflow behavior.
create or replace function private.hq_task(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 w text:=private.require_staff(); s text:=private.hq_staff_id();
 i text:=p_payload->>'id'; d jsonb:=p_payload->'data'; old jsonb; p jsonb;
 managed boolean; assigned boolean; checklist boolean; v integer; next_status text; member text;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in first.'; end if;
 if p_action='task-delete' then return private.hq_delete('delete-deliverable',jsonb_build_object('id',i,'version',p_payload->'version','confirmed',true)); end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>100000 or i is null or i !~ '^[a-zA-Z0-9_-]{1,180}$' then raise exception using errcode='22023',message='Check task fields.'; end if;
 if p_action not in ('save-task','task-status','task-delete','task-restore','task-metadata') then raise exception using errcode='22023',message='Unknown task action.'; end if;
 select data into old from public.marketing_records where workspace_id=w and kind='deliverable' and id=i;
 if coalesce(p_payload->>'version','') !~ '^\d{1,8}$' or (p_payload->>'version')::int<>coalesce((old->>'version')::int,0) then raise exception using errcode='40001',message='Someone changed this record. Reload before saving.'; end if;
 if old is null and p_action<>'save-task' then raise exception using errcode='22023',message='Deliverable not found.'; end if;
 select data into p from public.marketing_records where workspace_id=w and kind='project' and id=coalesce(old->>'projectId',d->>'projectId');
 checklist:=coalesce(p->'storeOpenChecklist'='true'::jsonb or (coalesce(d->>'projectId',old->>'projectId','')='' and coalesce(d->'storeOpenChecklist',old->'storeOpenChecklist')='true'::jsonb),false);
 managed:=coalesce(private.staff_role()='admin' or p->>'owner'=s or (coalesce(old->>'projectId','')='' and old->>'approver'=s),false);
 assigned:=coalesce(old->>'owner'=s or old->'contributors'?s or old->>'publisher'=s or p->'members'?s,false);
 if old->>'deletedAt' is not null and p_action<>'task-restore' then raise exception using errcode='22023',message='Restore this deliverable before changing it.'; end if;
 if p_action in ('save-task','task-metadata','task-delete','task-restore') and not managed then
  -- Checklist creation may assign colleagues. Elsewhere, project members may only add their own work.
  if not (p_action='save-task' and old is null and (checklist or (coalesce(p->'members'?s,false) and d->'assignees'=jsonb_build_array(s)))) then
   raise exception using errcode='42501',message='The project owner or an administrator manages assignments and schedules.';
  end if;
 end if;
 if p_action not in ('task-delete','task-restore') and p->>'status' in ('completed','archived') then raise exception using errcode='22023',message='Reopen the project before changing work.'; end if;
 if p_action='save-task' then
  if (p is null and not (checklist and coalesce(d->>'projectId','')='')) or (old is not null and old->>'workflow' is distinct from 'task') then raise exception using errcode='22023',message='Choose a project task. Publishing work keeps its existing workflow.'; end if;
  if jsonb_typeof(d) is distinct from 'object' or d-array['title','instructions','projectId','assignees','productionDue','endAt','priority','notes','storeOpenChecklist','department','assets','references','assetRoles','linkRoles','initialStatus']<>'{}'::jsonb or d->>'projectId' is distinct from coalesce(old->>'projectId',d->>'projectId') then raise exception using errcode='22023',message='Check task fields; keep work in its project.'; end if;
  perform private.hq_checklist_fields(d);
  if jsonb_typeof(d->'projectId') is distinct from 'string' or length(d->>'projectId')>180 then raise exception using errcode='22023',message='Choose a valid project.'; end if;
  if d->'storeOpenChecklist'='true'::jsonb and d->>'projectId'<>'' and p->'storeOpenChecklist' is distinct from 'true'::jsonb then raise exception using errcode='22023',message='Choose a Store Open Checklist project.'; end if;
  if d ? 'initialStatus' and (old is not null or coalesce(d->>'initialStatus','') not in ('not_started','in_progress','waiting','complete')) then raise exception using errcode='22023',message='Use the existing status action to update saved work.'; end if;
  next_status:=coalesce(d->>'initialStatus','not_started');
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
   ||(d-array['assignees','initialStatus'])||jsonb_build_object('owner',d->'assignees'->>0,'contributors',(d->'assignees')-0);
  if checklist then d:=d||jsonb_build_object('storeOpenChecklist',true); end if;
  if old is null then
   d:=d||jsonb_build_object('status',case next_status when 'not_started' then 'to_do' when 'complete' then 'done' else 'in_progress' end,'waiting',next_status='waiting');
  end if;
  if d->>'projectId'='' then d:=d||jsonb_build_object('approver',d->>'owner'); end if;
  perform private.hq_common(w,d); perform private.hq_materials(d);
 elsif p_action='task-status' then
  if old->>'workflow' is distinct from 'task' or not (managed or assigned) then raise exception using errcode='42501',message='Only assigned staff or the project manager can complete this task.'; end if;
  next_status:=p_payload->>'status';
  if next_status is null or next_status not in ('not_started','in_progress','waiting','complete') then raise exception using errcode='22023',message='Choose a task status.'; end if;
  d:=old||jsonb_build_object('status',case next_status when 'not_started' then 'to_do' when 'complete' then 'done' else 'in_progress' end,'waiting',next_status='waiting');
 elsif p_action='task-metadata' then
  if jsonb_typeof(d) is distinct from 'object' or d-array['priority','notes']<>'{}'::jsonb then raise exception using errcode='22023',message='Only priority and notes can be edited here.'; end if;
  d:=old||d;
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
 -- The preceding hq_00_deletion_guard enforces owner/admin and metadata-only deletion.
 if old.data->>'deletedAt' is null and new.data->>'deletedAt' is not null then return new; end if;
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
-- Exclude deleted children from automatic review invalidation.
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
  if old is null and d->'storeOpenChecklist' is distinct from 'true'::jsonb and not adm and not private.hq_capability(w,s,'coordinate_requests') and d->>'owner' not in ('',s) then raise exception using errcode='42501',message='Create your own project; an administrator can assign another owner.'; end if;
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
  for row in select id,data from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'projectId'=i and data->>'deletedAt' is null and data->>'status'='ready'
   and (data->'publishing'='false'::jsonb or exists(select 1 from jsonb_each(data->'publications') where value->>'status'<>'published')) loop
   perform private.hq_put(w,'deliverable',row.id,row.data||jsonb_build_object('status','needs_review','approval',null,'version',(row.data->>'version')::int+1,'updatedAt',now()),'project change requires review');
  end loop;
 end if;
 return result;
end $$;
create or replace function private.editorial_history() returns trigger language plpgsql security definer set search_path='' as $$
declare row record; d jsonb;
begin
 insert into public.radar_editorial_history(org_id,id,kind,record_id,data,version,actor,created_at)
 values(new.org_id,gen_random_uuid()::text,new.kind,new.id,new.data,new.version,new.actor,new.updated_at);
 if new.kind='queue' then
  update public.marketing_records post set data=jsonb_set(post.data,'{status}','"review"'::jsonb),updated_at=now()
  where post.workspace_id=new.org_id and post.kind='post' and post.data->>'radarId'=new.id
   and not exists(select 1 from public.marketing_records hq where hq.workspace_id=new.org_id and hq.kind='deliverable' and hq.data->>'legacyPostId'=post.id);
  for row in select id,data from public.marketing_records where workspace_id=new.org_id and kind='deliverable' and data->>'legacyEditorialId'=new.id and data->>'deletedAt' is null loop
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
-- Retained comments and spending remain readable, without new writes.
create or replace function private.hq_operations(act text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); i text:=payload->>'id'; d jsonb; p jsonb; old jsonb; v int; row record; existing public.hq_spend; entry public.hq_spend; comment public.hq_comments; offset_n int; total jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if act in ('comment','reschedule','spend','spend-reverse') and exists(
  select 1 from public.marketing_records where workspace_id=w
  and kind=case when act='comment' then payload->>'kind' when act='reschedule' then 'deliverable' else 'project' end
  and id=case when act in ('spend','spend-reverse') then payload->>'projectId' else i end
  and data->>'deletedAt' is not null
 ) then raise exception using errcode='22023',message='This item is deleted and read-only. Reload the saved records.'; end if;
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
commit;
