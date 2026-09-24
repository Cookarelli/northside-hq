begin;
-- Reuse the existing append-only spending ledger. Old project entries stay unassigned.
alter table public.hq_spend add column if not exists deliverable_id text;
alter table public.hq_spend add column if not exists auction_campaign_id text;
create index if not exists hq_spend_deliverable on public.hq_spend(org_id,deliverable_id,created_at desc,id) where deliverable_id is not null;

create or replace function private.hq_clear_reconciliation(w text,i text) returns void
language plpgsql set search_path='' as $$
declare c jsonb;
begin
 select data into c from public.marketing_records where workspace_id=w and kind='auction_campaign' and id=i;
 if c->'reconciliation'->>'at' is null then return; end if;
 c:=c||jsonb_build_object('reconciliation',null,'version',(c->>'version')::int+1,'updatedAt',now());
 if auth.uid() is not null then perform private.hq_put(w,'auction_campaign',i,c,'auction reconciliation reopened after a change');
 else
  update public.marketing_records set data=c,updated_at=now() where workspace_id=w and kind='auction_campaign' and id=i;
  insert into public.hq_activity(org_id,kind,record_id,project_id,actor,action,snapshot) values(w,'auction_campaign',i,c->>'projectId','migration','auction reconciliation reopened after a change',c);
 end if;
end $$;

create or replace function private.hq_auction_finance_guard() returns trigger
language plpgsql set search_path='' as $$
declare total bigint; has_entries boolean; field text;
begin
 if new.kind='deliverable' then
  select count(*)>0,coalesce(sum(amount_cents),0) into has_entries,total from public.hq_spend where org_id=new.workspace_id and deliverable_id=new.id;
  if has_entries then
   if new.data->'actualSpendCents' is distinct from to_jsonb(total) then raise exception using errcode='22023',message='Actual spend is calculated from its channel entries. Correct an entry to change the total.'; end if;
   new.data:=new.data||jsonb_build_object('spendLedger',true);
  end if;
 elsif new.kind='auction_campaign' and tg_op='UPDATE' and old.data->'reconciliation'->>'at' is not null then
  foreach field in array array['auction_number','name','closesAt','campaignBudgetCents'] loop
   if new.data->field is distinct from old.data->field then new.data:=new.data||jsonb_build_object('reconciliation',null);exit;end if;
  end loop;
 end if;
 return new;
end $$;
create or replace trigger hq_auction_finance_guard before insert or update on public.marketing_records for each row when(new.kind in ('deliverable','auction_campaign')) execute function private.hq_auction_finance_guard();

create or replace function private.hq_auction_reconciliation_changed() returns trigger
language plpgsql set search_path='' as $$
declare field text; changed boolean:=tg_op<>'UPDATE';
begin
 if tg_op='UPDATE' then
  foreach field in array array['plannedBudgetCents','actualSpendCents','status','publications','deletedAt','auctionCampaignId'] loop
   if old.data->field is distinct from new.data->field then changed:=true;exit;end if;
  end loop;
 end if;
 if changed then
  if tg_op<>'INSERT' then perform private.hq_clear_reconciliation(old.workspace_id,old.data->>'auctionCampaignId');end if;
  if tg_op<>'DELETE' then perform private.hq_clear_reconciliation(new.workspace_id,new.data->>'auctionCampaignId');end if;
 end if;
 return null;
end $$;
create or replace trigger hq_auction_reconciliation_changed after insert or update or delete on public.marketing_records for each row execute function private.hq_auction_reconciliation_changed();

-- This also catches a correction submitted through the existing project-spending screen.
create or replace function private.hq_auction_spend_guard() returns trigger
language plpgsql set search_path='' as $$
declare original public.hq_spend; d jsonb; p jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.org_id,0));
 if new.reverses is not null then
  select * into original from public.hq_spend where org_id=new.org_id and id=new.reverses;
  if original.deliverable_id is not null then new.deliverable_id:=original.deliverable_id;new.auction_campaign_id:=original.auction_campaign_id;end if;
 end if;
 if new.deliverable_id is null then return new;end if;
 select data into d from public.marketing_records where workspace_id=new.org_id and kind='deliverable' and id=new.deliverable_id;
 select data into p from public.marketing_records where workspace_id=new.org_id and kind='project' and id=d->>'projectId';
 if d is null or d->>'projectId' is distinct from new.project_id or d->>'auctionCampaignId' is distinct from new.auction_campaign_id then raise exception using errcode='22023',message='Spending must remain with its auction and deliverable.';end if;
 if auth.uid() is not null and (private.require_staff() is distinct from new.org_id or not private.hq_can_work(d,p,private.hq_staff_id())) then raise exception using errcode='42501',message='Only involved staff may record this deliverable spending.';end if;
 return new;
end $$;
create or replace trigger hq_auction_spend_guard before insert on public.hq_spend for each row execute function private.hq_auction_spend_guard();

create or replace function private.hq_auction_spend_sync() returns trigger
language plpgsql set search_path='' as $$
declare d jsonb; total bigint;
begin
 if new.deliverable_id is null then return null;end if;
 select data into d from public.marketing_records where workspace_id=new.org_id and kind='deliverable' and id=new.deliverable_id;
 select sum(amount_cents) into total from public.hq_spend where org_id=new.org_id and deliverable_id=new.deliverable_id;
 if total<0 or total>999999999999 then raise exception using errcode='22023',message='The deliverable total must be between zero and 999,999,999,999 cents.';end if;
 d:=d||jsonb_build_object('actualSpendCents',total,'spendLedger',true,'version',(d->>'version')::int+1,'updatedAt',now(),'budgetUpdatedAt',now(),'budgetUpdatedBy',new.actor);
 perform private.hq_put(new.org_id,'deliverable',new.deliverable_id,d,case when new.reverses is null then 'channel spending recorded' else 'channel spending corrected' end);
 -- A correction can leave the same net total, but still needs another reconciliation.
 perform private.hq_clear_reconciliation(new.org_id,new.auction_campaign_id);
 return null;
end $$;
create or replace trigger hq_auction_spend_sync after insert on public.hq_spend for each row execute function private.hq_auction_spend_sync();

create or replace function private.hq_auction_finance(act text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff();s text:=private.hq_staff_id();i text:=payload->>'id';d jsonb;p jsonb;c jsonb;entry public.hq_spend;original public.hq_spend;existing public.hq_spend;offset_n integer;versions jsonb;items jsonb;planned bigint;actual bigint;budget bigint;baseline_id uuid;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sign in first.';end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>30000 then raise exception using errcode='22023',message='Check the auction request.';end if;
 if act='reconcile' then
  select data into c from public.marketing_records where workspace_id=w and kind='auction_campaign' and id=i;
  select data into p from public.marketing_records where workspace_id=w and kind='project' and id=c->>'projectId';
  if c is null then raise exception using errcode='22023',message='Auction not found.';end if;
  if not coalesce(private.staff_role()='admin' or p->>'owner'=s or p->'members'?s or c->>'owner'=s,false) then raise exception using errcode='42501',message='Only project members, the campaign owner or an administrator may reconcile this auction.';end if;
  if c->'reconciliation'->>'at' is not null then return jsonb_build_object('id',i,'kind','auction_campaign','data',c);end if;
  if payload->'version' is distinct from c->'version' then raise exception using errcode='40001',message='The auction changed. Review the latest totals before reconciling.';end if;
  select jsonb_object_agg(id,data->'version'),jsonb_agg(jsonb_build_object('id',id,'plannedBudgetCents',data->'plannedBudgetCents','actualSpendCents',data->'actualSpendCents')),coalesce(sum((data->>'plannedBudgetCents')::bigint),0),coalesce(sum((data->>'actualSpendCents')::bigint),0) into versions,items,planned,actual from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'auctionCampaignId'=i and data->>'deletedAt' is null;
  if versions is distinct from payload->'deliverableVersions' then raise exception using errcode='40001',message='A reminder changed. Review the latest totals before reconciling.';end if;
  if (select count(distinct data->>'reminderHours') from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'auctionCampaignId'=i and data->>'deletedAt' is null and data->>'reminderHours' in ('48','24','2'))<>3
   or exists(select 1 from public.marketing_records r where r.workspace_id=w and r.kind='deliverable' and r.data->>'auctionCampaignId'=i and r.data->>'deletedAt' is null and (r.data->>'actualSpendCents' is null or coalesce(jsonb_array_length(r.data->'platforms'),0)=0 or exists(select 1 from jsonb_array_elements_text(r.data->'platforms') platform where (r.data->'publications'->platform.value->>'status') is distinct from 'published'))) then
   raise exception using errcode='22023',message='Publish all three reminders and record actual spending or confirm no spend before reconciling.';
  end if;
  budget:=coalesce((c->>'campaignBudgetCents')::bigint,case when exists(select 1 from public.marketing_records where workspace_id=w and kind='deliverable' and data->>'auctionCampaignId'=i and data->>'deletedAt' is null and data->>'plannedBudgetCents' is not null) then planned end);
  c:=c||jsonb_build_object('reconciliation',jsonb_build_object('at',now(),'by',s,'budgetCents',budget,'actualCents',actual,'varianceCents',budget-actual,'deliverables',items),'version',(c->>'version')::int+1,'updatedAt',now());
  return private.hq_put(w,'auction_campaign',i,c,'auction reconciled');
 end if;
 select data into d from public.marketing_records where workspace_id=w and kind='deliverable' and id=payload->>'deliverableId';
 select data into p from public.marketing_records where workspace_id=w and kind='project' and id=d->>'projectId';
 if d is null or d->>'auctionCampaignId' is null then raise exception using errcode='22023',message='Choose an auction deliverable.';end if;
 if act='list' then
  if coalesce(payload->>'offset','0') !~ '^\d{1,8}$' then raise exception using errcode='22023',message='Choose a valid spending page.';end if;
  offset_n:=coalesce((payload->>'offset')::int,0);
  return jsonb_build_object('entries',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from (select a.*,exists(select 1 from public.hq_spend r where r.org_id=w and r.reverses=a.id) as reversed from public.hq_spend a where a.org_id=w and a.deliverable_id=payload->>'deliverableId' order by a.created_at desc,a.id limit 50 offset offset_n) e),'nextOffset',case when (select count(*) from public.hq_spend where org_id=w and deliverable_id=payload->>'deliverableId')>offset_n+50 then offset_n+50 else null end);
 end if;
 if act not in ('spend','reverse') then raise exception using errcode='22023',message='Unknown auction action.';end if;
 if not private.hq_can_work(d,p,s) then raise exception using errcode='42501',message='Only involved staff may record this deliverable spending.';end if;
 if d->>'deletedAt' is not null then raise exception using errcode='22023',message='Restore this deliverable before recording spending.';end if;
 if coalesce(i,'') !~ '^[0-9a-fA-F-]{36}$' or jsonb_typeof(payload->'note') is distinct from 'string' or length(payload->>'note')>2000 then raise exception using errcode='22023',message='Check the spending entry.';end if;
 entry.org_id:=w;entry.id:=i::uuid;entry.project_id:=d->>'projectId';entry.deliverable_id:=payload->>'deliverableId';entry.auction_campaign_id:=d->>'auctionCampaignId';entry.actor:=s;entry.note:=coalesce(nullif(btrim(payload->>'note'),''),'Actual spending');entry.created_at:=now();
 if act='spend' then
  if jsonb_typeof(payload->'amountCents') is distinct from 'number' or payload->>'amountCents' !~ '^[1-9]\d{0,11}$' or coalesce(payload->>'spentOn','') !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(payload->'channel') is distinct from 'string' or length(btrim(payload->>'channel')) not between 1 and 80 then raise exception using errcode='22023',message='Choose a channel, positive amount and spending date.';end if;
  entry.amount_cents:=(payload->>'amountCents')::bigint;entry.channel:=btrim(payload->>'channel');entry.category:=case when entry.channel='Creative production' then 'creative' else 'advertising' end;entry.spent_on:=(payload->>'spentOn')::date;
  if entry.spent_on>(now() at time zone 'America/Chicago')::date then raise exception using errcode='22023',message='Actual spending cannot be dated in the future.';end if;
 else
  select * into original from public.hq_spend where org_id=w and deliverable_id=entry.deliverable_id and id=(payload->>'reverses')::uuid and reverses is null;
  if original.id is null then raise exception using errcode='22023',message='Choose an original entry on this deliverable.';end if;
  if length(btrim(payload->>'note'))=0 then raise exception using errcode='22023',message='Add a correction reason.';end if;
  entry.amount_cents:=-original.amount_cents;entry.channel:=original.channel;entry.category:=original.category;entry.spent_on:=original.spent_on;entry.reverses:=original.id;
 end if;
 select * into existing from public.hq_spend where org_id=w and id=entry.id;
 if existing.id is not null then
  if to_jsonb(existing)-'created_at' is distinct from to_jsonb(entry)-'created_at' then raise exception using errcode='22023',message='This spending request was already used for different details.';end if;
  return jsonb_build_object('id',entry.deliverable_id,'data',d);
 end if;
 if payload->'version' is distinct from d->'version' then raise exception using errcode='40001',message='The deliverable changed. Reload before recording spending.';end if;
 if entry.reverses is not null and exists(select 1 from public.hq_spend where org_id=w and reverses=entry.reverses) then raise exception using errcode='22023',message='This entry was already corrected.';end if;
 -- Preserve a previously entered actual total as an explicit opening entry, once.
 if not exists(select 1 from public.hq_spend where org_id=w and deliverable_id=entry.deliverable_id) and coalesce((d->>'actualSpendCents')::bigint,0)>0 then
  baseline_id:=md5('auction-spend-baseline:'||w||':'||entry.deliverable_id)::uuid;
  insert into public.hq_spend(org_id,id,project_id,deliverable_id,auction_campaign_id,category,amount_cents,channel,spent_on,note,actor) values(w,baseline_id,entry.project_id,entry.deliverable_id,entry.auction_campaign_id,'advertising',(d->>'actualSpendCents')::bigint,'Previously recorded',(now() at time zone 'America/Chicago')::date,'Preserved actual total entered before channel tracking',s);
 end if;
 insert into public.hq_spend select entry.*;
 select data into d from public.marketing_records where workspace_id=w and kind='deliverable' and id=entry.deliverable_id;
 return jsonb_build_object('id',entry.deliverable_id,'data',d);
end $$;

create or replace function public.hub_auction_finance(p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.hq_auction_finance(p_action,p_payload) $$;
revoke all on function private.hq_clear_reconciliation(text,text),private.hq_auction_finance_guard(),private.hq_auction_reconciliation_changed(),private.hq_auction_spend_guard(),private.hq_auction_spend_sync(),private.hq_auction_finance(text,jsonb),public.hub_auction_finance(text,jsonb) from public,anon,authenticated;
grant execute on function private.hq_auction_finance(text,jsonb),public.hub_auction_finance(text,jsonb) to authenticated;
-- Keep legacy project corrections on the same checked deliverable path, including retries.
create or replace function public.hub_hq_operations(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare linked text;v jsonb;
begin
 if p_action='spend-reverse' then
  select deliverable_id into linked from public.hq_spend where id=(p_payload->>'reverses')::uuid and project_id=p_payload->>'projectId';
  if linked is not null then
   select data->'version' into v from public.marketing_records where kind='deliverable' and id=linked;
   return private.hq_auction_finance('reverse',jsonb_build_object('id',p_payload->'id','deliverableId',linked,'version',v,'reverses',p_payload->'reverses','note',p_payload->'note'));
  end if;
 end if;
 return private.hq_operations(p_action,p_payload);
end $$;
commit;
