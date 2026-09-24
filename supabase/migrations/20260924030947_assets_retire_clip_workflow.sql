-- Retire clip-job writes, retaining every historical record and uploaded object.
-- No schema/table changes, record deletion, or speculative ownership backfill.
-- Existing RPC grants and org/NDA checks stay intact. Safe to reapply.
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
   if (existing-'uploadedBy') is distinct from (p_data-'uploadedBy') then
    raise exception using errcode='22023',message='Upload details are immutable. Start a new upload.';
   end if;
   return;
  end if;
  -- The authenticated staff identity, never a client-supplied owner claim.
  p_data:=p_data||jsonb_build_object('uploadedBy',private.hq_staff_id());
  if p_data->>'key' is distinct from w||'/'||p_id or (p_data->>'size')::bigint not between 1 and 41943040
   or p_data->>'type' not in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm') then
   raise exception using errcode='22023',message='Invalid upload.';
  end if;
 end if;
 if p_kind='asset' then
  select data into pending from public.marketing_records where workspace_id=w and kind='upload' and id=p_id;
  if pending is null or pending is distinct from p_data or not exists (
   select 1 from storage.objects where bucket_id='marketing-assets' and name=pending->>'key'
    and (metadata->>'size')::bigint=(pending->>'size')::bigint and metadata->>'mimetype'=pending->>'type'
  ) then raise exception using errcode='22023',message='Upload must finish before saving the asset.'; end if;
 end if;
 insert into public.marketing_records(workspace_id,kind,id,data) values(w,p_kind,p_id,p_data)
 on conflict(workspace_id,kind,id) do update set data=excluded.data,updated_at=now();
end $$;
