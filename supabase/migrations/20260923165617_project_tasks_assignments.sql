begin;
-- Extend canonical JSON records. No row rewrites, calendar copies, or new identities.
-- The existing staff-access and agreement checks are retained for every action.
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
 assigned:=coalesce(old->>'owner'=s or old->'contributors'?s or old->>'publisher'=s,false);
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
revoke all on function private.hq_task(text,jsonb) from public,anon,authenticated;
grant execute on function private.hq_task(text,jsonb) to authenticated;
create or replace function public.hub_project_tasks(p_action text,p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select private.hq_task(p_action,p_payload) $$;
revoke all on function public.hub_project_tasks(text,jsonb) from public,anon,authenticated;
grant execute on function public.hub_project_tasks(text,jsonb) to authenticated;

-- Enforce task permissions even through older RPC endpoints. No policy is broadened.
create or replace function private.hq_task_guard() returns trigger language plpgsql set search_path='' as $$
declare s text:=private.hq_staff_id(); p jsonb; manager boolean; allowed text[]:=array['status','waiting','version','updatedAt','completedAt'];
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
  if not manager and (not coalesce(old.data->>'owner'=s or old.data->'contributors'?s,false) or new.data-allowed is distinct from old.data-allowed) then raise exception using errcode='42501',message='Assigned staff can change task status; the manager edits task details.'; end if;
  if coalesce(new.data->>'endAt','')<>'' and (coalesce(new.data->>'productionDue','')='' or new.data->>'endAt'<=new.data->>'productionDue') then raise exception using errcode='22023',message='The end must follow the due/start time.'; end if;
 end if;
 if new.data->>'status'='done' and old.data->>'status' is distinct from 'done' then new.data:=new.data||jsonb_build_object('completedAt',now()); elsif new.data->>'status'<>'done' then new.data:=new.data-'completedAt'; end if;
 return new;
end $$;
revoke all on function private.hq_task_guard() from public,anon,authenticated;
drop trigger if exists hq_task_guard on public.marketing_records;
create trigger hq_task_guard before insert or update on public.marketing_records for each row execute function private.hq_task_guard();

-- Keep notification history, but resolve reminders for recoverably deleted work.
create or replace function private.hq_reminders(w text,s text,clock_at timestamptz) returns integer language plpgsql set search_path='' as $$
declare r record; d jsonb; p jsonb; field text; wall text; due_at timestamptz; phase text; ek text; title text; platform text;
 active_keys text[]:='{}'; inserted integer:=0; before_count integer;
begin
 select count(*) into before_count from public.hq_notifications where org_id=w and recipient=s and category='deadline';
 for r in select kind,id,data from public.marketing_records where workspace_id=w and kind in ('project','deliverable') loop
  d:=r.data;
  if d->>'deletedAt' is not null then continue; end if;
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
commit;
