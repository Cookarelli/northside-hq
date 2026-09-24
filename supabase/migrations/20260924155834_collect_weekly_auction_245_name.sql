-- Rename existing #245 copy without changing IDs, links, staffing, schedules,
-- budgets, publications, or immutable migration/audit snapshots.
begin;
do $rename$
declare c record; r record; d jsonb; field text;
 label constant text := 'Collect Weekly Auction #245';
 pattern constant text := 'Michael[[:space:]]+Jordan([[:space:]]+(Consignment Video Campaign|Consignment Video|Consignment|Auction))?';
begin
 for c in select * from public.marketing_records where workspace_id='northside-marketing'
  and kind='auction_campaign' and data->>'auction_number'='245' for update loop
  perform pg_advisory_xact_lock(hashtextextended(c.workspace_id,0));
  if exists(select 1 from public.hq_activity where org_id=c.workspace_id and kind='auction_campaign'
    and record_id=c.id and action='auction-245-name-updated') then continue; end if;
  -- Use the existing campaign trigger to synchronize its shared reference.
  d:=c.data||jsonb_build_object('name',label);
  foreach field in array array['featuredCard','internalNotes'] loop
   if jsonb_typeof(d->field)='string' then d:=jsonb_set(d,array[field],to_jsonb(regexp_replace(d->>field,pattern,label,'gi'))); end if;
  end loop;
  if d is distinct from c.data then
   d:=d||jsonb_build_object('version',coalesce((d->>'version')::int,0)+1,'updatedAt',now(),'updatedBy','migration');
   update public.marketing_records set data=d,updated_at=now() where workspace_id=c.workspace_id and kind=c.kind and id=c.id;
  end if;
  for r in select * from public.marketing_records where workspace_id=c.workspace_id and (
   kind='deliverable' and (data->>'auctionCampaignId'=c.id or data->>'sourceProjectId'=c.data->>'sourceProjectId')
   or kind='project' and id=c.data->>'sourceProjectId'
   or kind='asset' and data->>'assignedDeliverableId' in (select id from public.marketing_records where workspace_id=c.workspace_id and kind='deliverable' and data->>'auctionCampaignId'=c.id)
  ) for update loop
   d:=r.data;
   foreach field in array array['name','title','instructions','caption','campaignBrief','brief','notes','note','internalNotes','featuredCard','campaignFeaturedCard','blockedReason'] loop
    if jsonb_typeof(d->field)='string' then d:=jsonb_set(d,array[field],to_jsonb(regexp_replace(d->>field,pattern,label,'gi'))); end if;
   end loop;
   if r.kind='project' then d:=d||jsonb_build_object('title',label); end if;
   if r.kind='deliverable' then
    d:=d||jsonb_build_object('campaignReference',label);
    if d->>'reminderHours' in ('48','24','2') then d:=d||jsonb_build_object('title',label||' — '||(d->>'reminderHours')||' Hour Reminder'); end if;
   end if;
   if d is distinct from r.data then
    d:=d||jsonb_build_object('version',coalesce((d->>'version')::int,0)+1,'updatedAt',now());
    update public.marketing_records set data=d,updated_at=now() where workspace_id=r.workspace_id and kind=r.kind and id=r.id;
    insert into public.hq_activity(org_id,kind,record_id,project_id,actor,action,snapshot)
     values(r.workspace_id,r.kind,r.id,c.data->>'projectId','migration','auction-245-copy-updated',d);
   end if;
  end loop;
  update public.hq_notifications set message=regexp_replace(message,pattern,label,'gi')
   where org_id=c.workspace_id and (record_id=c.data->>'sourceProjectId' or record_id in
    (select id from public.marketing_records where workspace_id=c.workspace_id and kind='deliverable' and data->>'auctionCampaignId'=c.id))
   and message ~* pattern;
  insert into public.hq_activity(org_id,kind,record_id,project_id,actor,action,snapshot)
   values(c.workspace_id,c.kind,c.id,c.data->>'projectId','migration','auction-245-name-updated',jsonb_build_object('title',label,'previousName',c.data->>'name'));
 end loop;
end $rename$;
commit;
