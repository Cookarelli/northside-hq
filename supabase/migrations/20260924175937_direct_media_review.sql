-- One immutable storage object / asset ID is one media version. Existing records,
-- private storage policies, deliverable approval and publishing RPCs remain in place.
begin;
create or replace function private.media_review_required(a jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(a->>'uploadedBy',a->>'owner','')='jon'
  and (coalesce(a->>'type','') like 'image/%' or coalesce(a->>'type','') like 'video/%')
$$;

create or replace function private.media_destination(w text,p_id text,d_id text) returns void
language plpgsql set search_path='' as $$
declare d jsonb; p jsonb;
begin
 if length(coalesce(p_id,''))>180 or length(coalesce(d_id,''))>180 then
  raise exception using errcode='22023',message='Check upload destination.';
 end if;
 if coalesce(d_id,'')<>'' then
  select data into d from public.marketing_records where workspace_id=w and kind='deliverable' and id=d_id;
  if d is null or coalesce(d->>'deletedAt','')<>'' then raise exception using errcode='22023',message='Choose an available deliverable.'; end if;
  if coalesce(p_id,'')<>'' and p_id is distinct from coalesce(d->>'projectId','') then
   raise exception using errcode='22023',message='Choose a deliverable in the selected project.';
  end if;
  p_id:=d->>'projectId';
 end if;
 if coalesce(p_id,'')<>'' then
  select data into p from public.marketing_records where workspace_id=w and kind='project' and id=p_id;
  if p is null or coalesce(p->>'deletedAt','')<>'' or coalesce(p->>'migratedToProjectId','')<>'' then
   raise exception using errcode='22023',message='Choose an available project.';
  end if;
 end if;
end $$;

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
   or p_data-array['id','key','name','type','size','createdAt','uploadedAt','uploadedBy','collection','title','note','uploadProjectId','uploadDeliverableId']<>'{}'::jsonb
   or p_data->>'id' is distinct from p_id
   or jsonb_typeof(p_data->'name') is distinct from 'string' or length(btrim(p_data->>'name')) not between 1 and 250
   or (p_data ? 'collection' and p_data->>'collection' is distinct from 'jons-content')
   or (p_data ? 'title' and (jsonb_typeof(p_data->'title') is distinct from 'string' or length(p_data->>'title')>250))
   or (p_data ? 'note' and (jsonb_typeof(p_data->'note') is distinct from 'string' or length(p_data->>'note')>500))
   or (p_data->>'size') !~ '^[0-9]+$' or jsonb_typeof(p_data->'size') is distinct from 'number' or jsonb_typeof(p_data->'type') is distinct from 'string' then
   raise exception using errcode='22023',message='Check upload details and destination.';
  end if;
  if (p_data ? 'uploadProjectId' and jsonb_typeof(p_data->'uploadProjectId') is distinct from 'string')
   or (p_data ? 'uploadDeliverableId' and jsonb_typeof(p_data->'uploadDeliverableId') is distinct from 'string') then
   raise exception using errcode='22023',message='Check upload destination.';
  end if;
  perform private.media_destination(w,p_data->>'uploadProjectId',p_data->>'uploadDeliverableId');
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
  if private.media_review_required(p_data) then
   p_data:=p_data||jsonb_build_object('mediaReview',jsonb_build_object('status','in_review','version',0));
  end if;
 end if;
 insert into public.marketing_records(workspace_id,kind,id,data) values(w,p_kind,p_id,p_data)
 on conflict(workspace_id,kind,id) do update set data=excluded.data,updated_at=now();
 if p_kind='asset' then
  perform private.hq_log(w,'asset',p_id,p_data,'media uploaded');
  if coalesce(p_data->>'uploadProjectId','')<>'' or coalesce(p_data->>'uploadDeliverableId','')<>'' then
   perform private.assign_asset(p_id,0,p_data->>'uploadProjectId',p_data->>'uploadDeliverableId');
  end if;
 end if;
end $$;

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
 perform private.hq_log(w,'asset',p_id,old,'previous media assignment');
 -- Waiting/publication evidence belongs to an exact destination, not the whole project.
 if coalesce(old->'mediaReview'->>'status','') in ('waiting','completed')
  and coalesce(nullif(old->>'assignedDeliverableId',''),nullif(old->'mediaReview'->'waiting'->>'deliverableId',''),nullif(old->'mediaReview'->'completed'->>'deliverableId',''),'') is distinct from deliverable_id then
  old:=jsonb_set(old,'{mediaReview}',((old->'mediaReview')-'waiting'-'completed')||jsonb_build_object(
   'status',case when old->'mediaReview'->'approval'->>'assetId'=p_id then 'approved' else 'in_review' end,
   'version',coalesce((old->'mediaReview'->>'version')::int,0)+1));
 end if;
 old:=old||jsonb_build_object('assignedProjectId',project_id,'assignedDeliverableId',deliverable_id,'assignedBy',s,'assignedAt',now(),'assignmentVersion',p_version+1);
 update public.marketing_records set data=old,updated_at=now() where workspace_id=w and kind='asset' and id=p_id;
 perform private.hq_log(w,'asset',p_id,old,'media assigned');
 return jsonb_build_object('id',p_id,'kind','asset','data',old);
end $$;
-- Only a recorded publication of this exact immutable file, on EVERY required
-- platform, proves completion. A due date, Done flag or reference attachment does not.
create or replace function private.media_publication(d jsonb,asset_id text) returns boolean
language sql stable set search_path='' as $$
 select coalesce(d->'publishing'='true'::jsonb and jsonb_array_length(d->'platforms')>0
 and not exists(select 1 from jsonb_array_elements_text(d->'platforms') platform where
  coalesce(d->'publications'->platform->>'status','')<>'published'
  or nullif(d->'publications'->platform->>'recordedBy','') is null
  or coalesce(private.hq_time(d->'publications'->platform->>'recordedAt'),'')=''
  or coalesce(private.hq_time(d->'publications'->platform->>'publishedAt'),'')=''
  or not coalesce(d->'publications'->platform->'approval'->'package'->'finalAssets' ? asset_id,false)
  or not (coalesce(d->'publications'->platform->>'liveUrl','') ~ '^https://'
   or length(coalesce(d->'publications'->platform->>'unavailableReason',''))>=5)),false)
$$;

create or replace function private.sync_media_completion(w text,asset_id text) returns void
language plpgsql set search_path='' as $$
declare a jsonb; r record; review jsonb; destination text;
begin
 select data into a from public.marketing_records where workspace_id=w and kind='asset' and id=asset_id;
 if not private.media_review_required(a) then return; end if;
 review:=coalesce(a->'mediaReview','{"status":"in_review","version":0}'::jsonb);
 destination:=coalesce(nullif(a->>'assignedDeliverableId',''),nullif(review->'waiting'->>'deliverableId',''));
 for r in select id,data from public.marketing_records where workspace_id=w and kind='deliverable'
  and (destination is null or id=destination)
  and (nullif(a->>'assignedProjectId','') is null or data->>'projectId'=a->>'assignedProjectId')
  and private.media_publication(data,asset_id) order by id loop
  if review->>'status'='completed' and review->'completed'->>'deliverableId'=r.id then return; end if;
  review:=review||jsonb_build_object('status','completed','version',coalesce((review->>'version')::int,0)+1,
   'completed',jsonb_build_object('deliverableId',r.id,'publications',r.data->'publications'));
  a:=a||jsonb_build_object('mediaReview',review);
  update public.marketing_records set data=a,updated_at=now() where workspace_id=w and kind='asset' and id=asset_id;
  -- Migration runs have no authenticated actor. Preserve evidence, never invent one.
  if private.hq_staff_id() is not null then perform private.hq_log(w,'asset',asset_id,a,'media completed'); end if;
  return;
 end loop;
end $$;

create or replace function private.review_media(p_id text,p_version integer,p_action text,p_deliverable_id text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); s text:=private.hq_staff_id(); a jsonb; review jsonb; d jsonb; p jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Staff access required.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w,0));
 select data into a from public.marketing_records where workspace_id=w and kind='asset' and id=p_id;
 if a is null or not private.media_review_required(a) then raise exception using errcode='22023',message='Choose a photo or video uploaded by Jon.'; end if;
 if p_note is null or length(p_note)>1000 then raise exception using errcode='22023',message='Keep the review note under 1,000 characters.'; end if;
 review:=coalesce(a->'mediaReview','{"status":"in_review","version":0}'::jsonb);
 if p_version is null or p_version<>coalesce((review->>'version')::int,0) then
  raise exception using errcode='40001',message='This media changed. Reload it before continuing.';
 end if;
 if p_action='approve' then
  -- Stable, verified staff IDs: Nick is nick; Nik is nikb. No admin grant or override.
  if s not in ('joey','steve','brody','nick') or s=a->>'uploadedBy' then
   raise exception using errcode='42501',message='Only Joey, Steve, Brody or Nick can approve Jon’s media.';
  end if;
  if review->>'status'<>'in_review' then raise exception using errcode='22023',message='Only media In Review can be approved.'; end if;
  review:=review||jsonb_build_object('status','approved','approval',jsonb_build_object('assetId',p_id,'by',s,'at',now(),'note',btrim(p_note)));
 elsif p_action='waiting' then
  if review->>'status'<>'approved' or review->'approval'->>'assetId' is distinct from p_id then
   raise exception using errcode='22023',message='Approve this media version before marking it Waiting.';
  end if;
  select data into d from public.marketing_records where workspace_id=w and kind='deliverable' and id=p_deliverable_id;
  if d is null or coalesce(d->>'deletedAt','')<>'' or d->'publishing' is distinct from 'true'::jsonb
   or (coalesce(a->>'assignedProjectId','')<>'' and a->>'assignedProjectId' is distinct from coalesce(d->>'projectId',''))
   or (coalesce(a->>'assignedDeliverableId','')<>'' and a->>'assignedDeliverableId'<>p_deliverable_id)
   or not (coalesce(a->>'assignedDeliverableId','')=p_deliverable_id or coalesce(private.hq_package(d)->'finalAssets' ? p_id,false)) then
   raise exception using errcode='22023',message='Choose the associated publishing deliverable.';
  end if;
  select data into p from public.marketing_records where workspace_id=w and kind='project' and id=d->>'projectId';
  if not coalesce(private.hq_can_work(d,p,s),false) then raise exception using errcode='42501',message='Only staff who manage publishing for this deliverable can mark it Waiting.'; end if;
  review:=review||jsonb_build_object('status','waiting','waiting',jsonb_build_object('deliverableId',p_deliverable_id,'by',s,'at',now()));
 else raise exception using errcode='22023',message='Choose Approve or Mark Waiting. Completion requires recorded publishing.';
 end if;
 review:=review||jsonb_build_object('version',p_version+1);
 a:=a||jsonb_build_object('mediaReview',review);
 update public.marketing_records set data=a,updated_at=now() where workspace_id=w and kind='asset' and id=p_id;
 perform private.hq_log(w,'asset',p_id,a,'media '||p_action);
 return jsonb_build_object('id',p_id,'kind','asset','data',a);
end $$;
create or replace function public.hub_review_media(p_id text,p_version integer,p_action text,p_deliverable_id text default '',p_note text default '') returns jsonb
language sql security invoker set search_path='' as $$ select private.review_media(p_id,p_version,p_action,p_deliverable_id,p_note) $$;

-- Backfill only evidence for the current immutable media. Collection membership
-- alone never identifies Jon as uploader. No approvals, actors or times are invented.
do $$
declare r record; evidence record; review jsonb;
begin
 for r in select workspace_id,id,data from public.marketing_records where kind='asset'
  and private.media_review_required(data) and not data ? 'mediaReview' loop
  review:='{"status":"in_review","version":0}'::jsonb;
  for evidence in select id,data from public.marketing_records where workspace_id=r.workspace_id and kind='deliverable'
   and data->'approval'->'package'->'finalAssets' ? r.id
   and data->'approval'->>'by' in ('joey','steve','brody','nick')
   and coalesce(private.hq_time(data->'approval'->>'at'),'')<>''
   and data->'approval'->'contentVersion'=data->'contentVersion'
   and (nullif(r.data->>'assignedDeliverableId','') is null or id=r.data->>'assignedDeliverableId')
   order by data->'approval'->>'at' desc limit 1 loop
   review:=review||jsonb_build_object('status','approved','approval',jsonb_build_object('assetId',r.id,
    'by',evidence.data->'approval'->>'by','at',evidence.data->'approval'->>'at',
    'note',coalesce(evidence.data->'approval'->>'comment',''),'sourceDeliverableId',evidence.id));
  end loop;
  update public.marketing_records set data=data||jsonb_build_object('mediaReview',review)
   where workspace_id=r.workspace_id and kind='asset' and id=r.id;
  perform private.sync_media_completion(r.workspace_id,r.id);
 end loop;
end $$;

-- Guard all existing deliverable-writing RPCs. This supplements, rather than
-- replaces, their content approval, budget, assignment and publication checks.
create or replace function private.guard_media_publication() returns trigger
language plpgsql security definer set search_path='' as $$
declare asset_id text; a jsonb; review jsonb; changed_publication boolean;
begin
 if new.kind<>'deliverable' then return new; end if;
 changed_publication:=exists(select 1 from jsonb_each(coalesce(new.data->'publications','{}')) entry
  where entry.value->>'status' in ('scheduled','published')
   and (tg_op='INSERT' or entry.value is distinct from old.data->'publications'->entry.key));
 if (new.data->'approval' is not null and new.data->'approval'<>'null'::jsonb
  and (tg_op='INSERT' or new.data->'approval' is distinct from old.data->'approval')) or changed_publication then
  for asset_id in select jsonb_array_elements_text(private.hq_package(new.data)->'finalAssets') loop
   select data into a from public.marketing_records where workspace_id=new.workspace_id and kind='asset' and id=asset_id;
   if private.media_review_required(a) then
    review:=a->'mediaReview';
    if review->'approval'->>'assetId' is distinct from asset_id or coalesce(review->>'status','') not in ('approved','waiting','completed') then
     raise exception using errcode='22023',message='Jon’s final photos/videos need media approval before deliverable approval or publishing.';
    end if;
    if changed_publication and not (
     (review->>'status'='waiting' and review->'waiting'->>'deliverableId'=new.id)
     or (review->>'status'='completed' and review->'completed'->>'deliverableId'=new.id)) then
     raise exception using errcode='22023',message='Mark the approved media Waiting for this deliverable before recording publishing.';
    end if;
   end if;
  end loop;
 end if;
 return new;
end $$;
create or replace function private.complete_published_media() returns trigger
language plpgsql security definer set search_path='' as $$
declare r record;
begin
 if new.kind='deliverable' and (tg_op='INSERT' or new.data->'publications' is distinct from old.data->'publications') then
  for r in select id from public.marketing_records where workspace_id=new.workspace_id and kind='asset'
   and private.media_review_required(data) and private.media_publication(new.data,id) loop
   perform private.sync_media_completion(new.workspace_id,r.id);
  end loop;
 end if;
 return new;
end $$;
drop trigger if exists hq_media_publication_guard on public.marketing_records;
create trigger hq_media_publication_guard before insert or update on public.marketing_records for each row execute function private.guard_media_publication();
drop trigger if exists hq_media_completion on public.marketing_records;
create trigger hq_media_completion after insert or update on public.marketing_records for each row execute function private.complete_published_media();

revoke all on function private.media_review_required(jsonb),private.media_destination(text,text,text),private.media_publication(jsonb,text),private.sync_media_completion(text,text),private.guard_media_publication(),private.complete_published_media(),private.review_media(text,integer,text,text,text),public.hub_review_media(text,integer,text,text,text) from public,anon,authenticated;
grant execute on function private.review_media(text,integer,text,text,text),public.hub_review_media(text,integer,text,text,text) to authenticated;
commit;
