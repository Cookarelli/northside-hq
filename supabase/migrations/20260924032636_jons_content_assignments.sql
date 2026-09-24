-- Extend the existing private asset system; no new bucket, table or role.
-- Reapplicable and non-destructive. Historical provenance is not guessed.
begin;
create or replace function private.save_record(p_kind text,p_id text,p_data jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); pending jsonb; existing jsonb; campaign jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w,0));
 if p_kind='clipjob' then
  raise exception using errcode='22023',message='The editing workflow is retired. Historical records are read-only; use Assets for media.';
 end if;
 if p_kind='post' then
  select data into existing from public.marketing_records where workspace_id=w and kind='post' and id=p_id;
  if existing->'consignment' is distinct from p_data->'consignment' then
   raise exception using errcode='22023',message='Manage campaign membership through the campaign preview.';
  end if;
  if p_data ? 'consignment' then
   perform private.validate_consignment_post(p_data);
   select data into campaign from public.marketing_records where workspace_id=w and kind='campaign' and id=p_data->'consignment'->>'campaignId';
   perform private.assert_consignment_approval(p_data,campaign);
  end if;
  if p_data ? 'consignment' and (p_data->>'category' is distinct from 'Consignment' or p_data ? 'recurrence'
   or not exists(select 1 from private.staff_access where org_id=w and id=p_data->>'owner' and active)) then
   raise exception using errcode='22023',message='Check campaign category and assigned staff member.';
  end if;
 end if;
 if p_kind not in ('plan','post','link','metrics','request','upload','asset') or length(p_id) not between 1 and 180 then
  raise exception using errcode='22023',message='Invalid record.';
 end if;
 if p_kind='post' and (left(p_id,6)='radar_' or p_data ? 'radarId' or p_data ? 'radarOrg' or p_data ? 'radarVersion') then
  raise exception using errcode='42501',message='Edit Radar posts through the editorial review queue.';
 end if;
 if p_kind='upload' then
  select data into existing from public.marketing_records where workspace_id=w and kind='upload' and id=p_id;
  if existing is not null then
   if (existing-array['uploadedBy','createdAt','uploadedAt']) is distinct from (p_data-array['uploadedBy','createdAt','uploadedAt']) then
    raise exception using errcode='22023',message='Upload details are immutable. Start a new upload.';
   end if;
   return;
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
   or p_data-array['id','key','name','type','size','createdAt','uploadedAt','uploadedBy','collection','title','note']<>'{}'::jsonb
   or p_data->>'id' is distinct from p_id
   or jsonb_typeof(p_data->'name') is distinct from 'string' or length(btrim(p_data->>'name')) not between 1 and 250
   or (p_data ? 'collection' and p_data->>'collection' is distinct from 'jons-content')
   or (p_data ? 'title' and (jsonb_typeof(p_data->'title') is distinct from 'string' or length(p_data->>'title')>250))
   or (p_data ? 'note' and (jsonb_typeof(p_data->'note') is distinct from 'string' or length(p_data->>'note')>500))
   or (p_data->>'size') !~ '^[0-9]+$' or jsonb_typeof(p_data->'size') is distinct from 'number' or jsonb_typeof(p_data->'type') is distinct from 'string' then
   raise exception using errcode='22023',message='Check upload details. Assignment happens after upload.';
  end if;
  -- Provenance and timestamps always come from the authenticated server context.
  p_data:=p_data||jsonb_build_object('uploadedBy',private.hq_staff_id(),'createdAt',now(),'uploadedAt',now());
  if p_data->>'key' is distinct from w||'/'||p_id or (p_data->>'size')::bigint not between 1 and 41943040
   or p_data->>'type' not in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm','image/gif','image/svg+xml','application/pdf','text/plain','text/csv','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation') then
   raise exception using errcode='22023',message='Invalid upload.';
  end if;
 end if;
 if p_kind='asset' then
  -- A retry must never reset a later assignment or its audit metadata.
  if exists(select 1 from public.marketing_records where workspace_id=w and kind='asset' and id=p_id) then return; end if;
  select data into pending from public.marketing_records where workspace_id=w and kind='upload' and id=p_id;
  if pending is null or pending is distinct from p_data or not exists (
   select 1 from storage.objects where bucket_id='marketing-assets' and name=pending->>'key'
    and (metadata->>'size')::bigint=(pending->>'size')::bigint and metadata->>'mimetype'=pending->>'type'
  ) then raise exception using errcode='22023',message='Upload must finish before saving the asset.'; end if;
 end if;
 insert into public.marketing_records(workspace_id,kind,id,data) values(w,p_kind,p_id,p_data)
 on conflict(workspace_id,kind,id) do update set data=excluded.data,updated_at=now();
end $$;

-- Preserve private access and the existing file-size limit; add supported documents/graphics.
update storage.buckets set allowed_mime_types=array[
 'image/jpeg','image/png','image/webp','image/gif','image/svg+xml','video/mp4','video/quicktime','video/webm',
 'application/pdf','text/plain','text/csv','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
] where id='marketing-assets';

-- The same ordinary staff/NDA authorization as other workspace mutations.
-- Assignment is a reference, not an edit of approved content or a publishing package.
create or replace function private.assign_asset(p_id text,p_version integer,p_project_id text,p_deliverable_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); old jsonb; d jsonb; p jsonb;
 project_id text:=coalesce(p_project_id,''); deliverable_id text:=coalesce(p_deliverable_id,'');
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Staff access required.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w,0));
 select data into old from public.marketing_records where workspace_id=w and kind='asset' and id=p_id;
 if old is null then raise exception using errcode='22023',message='Asset not found. Reload the content list.'; end if;
 if p_version is null or p_version<0 then raise exception using errcode='22023',message='Reload this asset before assigning it.'; end if;
 if deliverable_id<>'' then
  select data into d from public.marketing_records where workspace_id=w and kind='deliverable' and id=deliverable_id;
  if d is null or coalesce(d->>'deletedAt','')<>'' then raise exception using errcode='22023',message='Choose an available deliverable.'; end if;
  if project_id<>'' and project_id is distinct from coalesce(d->>'projectId','') then
   raise exception using errcode='22023',message='Choose a deliverable in the selected project.';
  end if;
  project_id:=coalesce(d->>'projectId','');
 end if;
 if project_id<>'' then
  select data into p from public.marketing_records where workspace_id=w and kind='project' and id=project_id;
  if p is null or coalesce(p->>'deletedAt','')<>'' or coalesce(p->>'migratedToProjectId','')<>'' then
   raise exception using errcode='22023',message='Choose an available project.';
  end if;
 end if;
 -- Same destination is retry-safe, even after a successful response was lost.
 if coalesce(old->>'assignedProjectId','')=project_id and coalesce(old->>'assignedDeliverableId','')=deliverable_id then
  return jsonb_build_object('id',p_id,'kind','asset','data',old);
 end if;
 if coalesce((old->>'assignmentVersion')::integer,0)<>p_version then
  raise exception using errcode='40001',message='This assignment changed. Reload it before saving.';
 end if;
 old:=old||jsonb_build_object('assignedProjectId',project_id,'assignedDeliverableId',deliverable_id,'assignedBy',s,'assignedAt',now(),'assignmentVersion',p_version+1);
 update public.marketing_records set data=old,updated_at=now() where workspace_id=w and kind='asset' and id=p_id;
 return jsonb_build_object('id',p_id,'kind','asset','data',old);
end $$;
create or replace function public.hub_assign_asset(p_id text,p_version integer,p_project_id text,p_deliverable_id text) returns jsonb
language sql security invoker set search_path='' as $$ select private.assign_asset(p_id,p_version,p_project_id,p_deliverable_id) $$;
revoke all on function private.assign_asset(text,integer,text,text),public.hub_assign_asset(text,integer,text,text) from public,anon,authenticated;
grant execute on function private.assign_asset(text,integer,text,text),public.hub_assign_asset(text,integer,text,text) to authenticated;
commit;
