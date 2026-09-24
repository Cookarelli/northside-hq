begin;
set local lock_timeout = '10s';
-- Reuse canonical records and IDs. No replacement project, assets or calendar rows.
do $migration$
declare
 w constant text := 'northside-marketing';
 source_id constant text := 'mj-consignment-video-2026-09-23';
 migration_key constant text := 'mj-consignment-deliverables-v1';
 source jsonb; parent jsonb; parent_id text; matches integer;
 old jsonb; item jsonb; item_id text; hours integer; key text; merged jsonb;
 close_value text; closes_at timestamptz; anchor_date date; due_at text;
 source_snapshot jsonb; old_snapshot jsonb; stamp timestamptz := now();
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 select data into source from public.marketing_records
 where workspace_id=w and kind='project' and id=source_id for update;
 -- Empty/local workspaces have no campaign to migrate; never seed production examples.
 if source is null then return; end if;
 if source->>'migrationKey'=migration_key then return; end if;
 select count(*),min(id) into matches,parent_id from public.marketing_records
 where workspace_id=w and kind='project' and id<>source_id
 and data->>'title' in ('Collect Weekly Auctions','Collect Weekly Auction');
 if matches<>1 then raise exception 'Expected exactly one existing Collect Weekly Auctions project; found %.',matches; end if;
 select data into parent from public.marketing_records
 where workspace_id=w and kind='project' and id=parent_id for update;
 if parent->>'status'<>'active' then raise exception 'Collect Weekly Auctions must be active before migrating its campaign.'; end if;
 source_snapshot:=source;

 -- The campaign/lot closing time wins over the parent project's unrelated batch date.
 close_value:=coalesce(nullif(source->>'auctionClosesAt',''),nullif(source->'auction'->>'closesAt',''),nullif(parent->>'auctionClosesAt',''));
 if close_value is not null then
  closes_at:=case when close_value ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then close_value::timestamptz
    else close_value::timestamp at time zone 'America/Chicago' end;
  if extract(isodow from closes_at at time zone 'America/Chicago')<>7 then
   raise exception 'The saved campaign auction close must be a Sunday in America/Chicago.';
  end if;
 else
  -- Anchor a missing close to the campaign's creation week, never to migration-run time.
  anchor_date:=(coalesce((source->>'createdAt')::timestamptz,stamp) at time zone 'America/Chicago')::date;
  anchor_date:=anchor_date+(7-extract(isodow from anchor_date)::integer);
  closes_at:=(anchor_date+time '21:00') at time zone 'America/Chicago';
 end if;

 foreach hours in array array[48,24,2] loop
  item_id:='mj-consignment-video-'||hours||'h';
  select data into old from public.marketing_records
  where workspace_id=w and kind='deliverable' and id=item_id for update;
  if old is not null and old->>'projectId' not in (source_id,parent_id) then
   raise exception 'Reminder % belongs to a different project; migration stopped.',item_id;
  end if;
  -- Never overwrite a platform confirmation, a deleted task, or a different workflow.
  if old->>'workflow'='task' or old ? 'deletedAt' or exists(
   select 1 from jsonb_each(coalesce(old->'publications','{}')) where value->>'status' in ('scheduled','published')
  ) then raise exception 'Reminder % requires review before migration; its existing work is unchanged.',item_id; end if;
  old_snapshot:=old;
  if close_value is null then
   -- Without an exact timestamp, keep the requested wall-clock schedule through DST.
   due_at:=to_char(anchor_date-case hours when 48 then 2 when 24 then 1 else 0 end,'YYYY-MM-DD')
    ||case when hours=2 then 'T19:00' else 'T21:00' end;
  else
   due_at:=to_char((closes_at-make_interval(hours=>hours)) at time zone 'America/Chicago','YYYY-MM-DD"T"HH24:MI');
  end if;
  item:=jsonb_build_object('owner',coalesce(nullif(source->>'owner',''),parent->>'owner'),
   'contributors','[]'::jsonb,'instructions',coalesce(source->>'brief',''),'notes','',
   'assets','[]'::jsonb,'references','[]'::jsonb,'assetRoles','{}'::jsonb,'linkRoles','{}'::jsonb,
   'effort','standard','format','vertical short-form video','status','to_do','blocked',false,'caption','',
   'approval',null,'approver','','evidence','{}'::jsonb,'blockedBy','','platforms',jsonb_build_array('facebook','instagram'),
   'publisher',coalesce(source->>'owner',''),'publishing',true,'submission',null,
   'publications',jsonb_build_object('facebook',jsonb_build_object('status','planned'),'instagram',jsonb_build_object('status','planned')),
   'blockedReason','','promotionMode','organic','destinationUrl','','estimatedHours',null,
   'promotionCents',0,'requiresCaption',true,'promotionChannel','','requiresFinalFile',true,
   'createdAt',stamp,'createdBy',coalesce(source->>'createdBy',source->>'owner'))||coalesce(old,'{}');
  if coalesce(item->>'owner','')='' then item:=item||jsonb_build_object('owner',coalesce(nullif(source->>'owner',''),parent->>'owner')); end if;
  foreach key in array array['assets','references'] loop
   select coalesce(jsonb_agg(value order by first_position),'[]') into merged from (
    select value,min(ordinality) first_position from jsonb_array_elements(
     coalesce(item->key,'[]')||coalesce(source->key,'[]')) with ordinality group by value
   ) unioned;
   item:=jsonb_set(item,array[key],merged);
  end loop;
  select coalesce(jsonb_agg(value order by first_position),'[]') into merged from (
   select value,min(ordinality) first_position from jsonb_array_elements_text(
    coalesce(item->'contributors','[]')||coalesce(source->'members','[]')||jsonb_build_array(source->>'owner')) with ordinality
   where value is not null and value<>'' and value<>item->>'owner' group by value
  ) people;
  item:=item||jsonb_build_object('contributors',merged,
   'assetRoles',coalesce(source->'assetRoles','{}')||coalesce(item->'assetRoles','{}'),
   'linkRoles',coalesce(source->'linkRoles','{}')||coalesce(item->'linkRoles','{}'),
   'destinationUrl',coalesce(nullif(item->>'destinationUrl',''),nullif(source->'auction'->>'batchUrl',''),''),
   'title','Michael Jordan Auction — '||hours||' Hour Reminder','projectId',parent_id,
   'campaignReference','Michael Jordan Consignment','sourceProjectId',source_id,
   'campaignBrief',coalesce(source->>'brief',''),'campaignAuction',source->'auction',
   'auctionClosesAt',closes_at,'reminderHours',hours,'timezone','America/Chicago',
   'productionDue',due_at,'publishAt',due_at,'priority',coalesce(item->>'priority','normal'),
   'notes',concat_ws(E'\n\n',nullif(item->>'notes',''),nullif(source->>'notes','')),
   'approval',null,'submission',null,
   'status',case when item->>'status'='ready' then 'needs_review' else item->>'status' end,
   'version',coalesce((old->>'version')::integer,0)+1,'contentVersion',coalesce((old->>'contentVersion')::integer,0)+1,
   'updatedAt',stamp,'campaignMigration',jsonb_build_object('key',migration_key,'at',stamp,
    'sourceProject',source_snapshot,'previousDeliverable',old_snapshot,'closeWasInferred',close_value is null));
  insert into public.marketing_records(workspace_id,kind,id,data,updated_at) values(w,'deliverable',item_id,item,stamp)
  on conflict(workspace_id,kind,id) do update set data=excluded.data,updated_at=excluded.updated_at;
  insert into public.hq_activity(org_id,kind,record_id,project_id,actor,action,snapshot)
  values(w,'deliverable',item_id,parent_id,'migration','campaign-migrated',item);
 end loop;

 -- Preserve all parent settings, its unrelated auction, budget, assignments and work.
 if parent->>'title'='Collect Weekly Auction' then
  update public.marketing_records set data=parent||jsonb_build_object('title','Collect Weekly Auctions',
   'version',coalesce((parent->>'version')::integer,0)+1,'updatedAt',stamp),updated_at=stamp
  where workspace_id=w and kind='project' and id=parent_id;
  insert into public.hq_activity(org_id,kind,record_id,project_id,actor,action,snapshot)
  values(w,'project',parent_id,parent_id,'migration','project-renamed',jsonb_build_object('previous',parent,'title','Collect Weekly Auctions'));
 end if;
 update public.marketing_records set data=source||jsonb_build_object('status','archived','migratedToProjectId',parent_id,
  'migrationKey',migration_key,'migratedAt',stamp,'migrationSnapshot',source_snapshot,
  'version',coalesce((source->>'version')::integer,0)+1,'updatedAt',stamp),updated_at=stamp
 where workspace_id=w and kind='project' and id=source_id;
 insert into public.hq_activity(org_id,kind,record_id,project_id,actor,action,snapshot)
 values(w,'project',source_id,parent_id,'migration','campaign-migrated',jsonb_build_object('previous',source_snapshot,'migratedToProjectId',parent_id));
end $migration$;

-- Older clients and repeated seeds must not reactivate the archived campaign or
-- attach work to it. The original record, comments and activity remain readable.
create or replace function private.hq_migrated_project_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.kind='project' and old.data->>'migratedToProjectId' is not null then
  if new.data->>'status' is distinct from 'archived'
   or new.data->'migratedToProjectId' is distinct from old.data->'migratedToProjectId'
   or new.data->'migrationKey' is distinct from old.data->'migrationKey'
   or new.data->'migrationSnapshot' is distinct from old.data->'migrationSnapshot' then
   raise exception 'This campaign was migrated. Open its parent project to manage active work.';
  end if;
 end if;
 if new.kind='deliverable' and exists(select 1 from public.marketing_records
  where workspace_id=new.workspace_id and kind='project' and id=new.data->>'projectId'
  and data->>'migratedToProjectId' is not null) then
  raise exception 'This campaign was migrated. Add deliverables to its parent project.';
 end if;
 return new;
end $$;
revoke all on function private.hq_migrated_project_guard() from public,anon,authenticated;
drop trigger if exists hq_migrated_project_guard on public.marketing_records;
create trigger hq_migrated_project_guard before insert or update on public.marketing_records
 for each row execute function private.hq_migrated_project_guard();
commit;
