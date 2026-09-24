-- Rename the existing hub in place. Keep the plan/launch identity and all related work.
begin;
create or replace function private.preserve_store_open_checklist() returns trigger
language plpgsql security invoker set search_path='' as $$
declare previous jsonb;
begin
 if new.workspace_id<>'northside-marketing' or new.kind<>'plan' or new.id<>'launch' then return new; end if;
 previous:=case when tg_op='UPDATE' then old.data else new.data end;
 -- Older clients send only the original form fields. Retain other saved metadata.
 if tg_op='UPDATE' then new.data:=old.data||new.data; end if;
 if previous ? 'legacyLaunchPlanOpening' then
  new.data:=new.data||jsonb_build_object('legacyLaunchPlanOpening',previous->'legacyLaunchPlanOpening');
 elsif previous->>'title' is distinct from 'Store Open Checklist'
    or previous->>'launchDate' is distinct from '2026-11-20'
    or previous->>'launchTime' is distinct from '15:00'
    or previous->>'launchTimezone' is distinct from 'America/Chicago' then
  new.data:=new.data||jsonb_build_object('legacyLaunchPlanOpening',
   (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(previous)
    where key in ('title','launchDate','launchTime','launchTimezone')));
 end if;
 new.data:=new.data||jsonb_build_object('title','Store Open Checklist',
  'launchDate','2026-11-20','launchTime','15:00','launchTimezone','America/Chicago');
 return new;
end $$;
revoke all on function private.preserve_store_open_checklist() from public,anon,authenticated;
drop trigger if exists preserve_store_open_checklist on public.marketing_records;
create trigger preserve_store_open_checklist before insert or update on public.marketing_records
 for each row when (new.workspace_id='northside-marketing' and new.kind='plan' and new.id='launch')
 execute function private.preserve_store_open_checklist();

-- No insert, delete or ID change; no project, deliverable, assignment or history writes.
update public.marketing_records set data=data
where workspace_id='northside-marketing' and kind='plan' and id='launch'
 and (data->>'title' is distinct from 'Store Open Checklist'
  or data->>'launchDate' is distinct from '2026-11-20'
  or data->>'launchTime' is distinct from '15:00'
  or data->>'launchTimezone' is distinct from 'America/Chicago');
commit;
