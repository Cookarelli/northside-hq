begin;
-- One transaction over existing checked commands; no new data model or access grant.
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
  result:=public.hub_hq('save-deliverable',p_payload-'metadata');
 end if;
 if coalesce(old->>'priority','normal') is distinct from metadata->>'priority'
  or coalesce(old->>'notes','') is distinct from metadata->>'notes' then
  result:=public.hub_project_tasks('task-metadata',jsonb_build_object('id',p_payload->>'id',
   'version',result->'data'->'version','data',metadata));
 end if;
 return result;
end $$;
revoke all on function public.hub_auction_deliverable(jsonb) from public,anon,authenticated;
grant execute on function public.hub_auction_deliverable(jsonb) to authenticated;
commit;
