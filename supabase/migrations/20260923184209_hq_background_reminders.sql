begin;
-- Run the existing reminder rules on the database clock, without a browser session.
-- No email service, external requests, or production-record backfill is introduced.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Preserve imported offset-bearing dates; interpret them as instants in Chicago.
create or replace function private.hq_time(wall text) returns text
language plpgsql set search_path='' as $$
begin
 if wall ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then
  wall:=to_char(wall::timestamptz at time zone 'America/Chicago','YYYY-MM-DD"T"HH24:MI');
 end if;
 perform private.consignment_time(wall);
 return wall;
exception when others then return '';
end $$;
revoke all on function private.hq_time(text) from public,anon,authenticated,service_role;

create table if not exists private.hq_reminder_runs (
 org_id text primary key,
 checked_at timestamptz not null,
 completed_at timestamptz,
 failed_staff integer not null default 0 check (failed_staff>=0)
);
alter table private.hq_reminder_runs enable row level security;
revoke all on private.hq_reminder_runs from public,anon,authenticated,service_role;

create or replace function private.hq_refresh_reminders() returns jsonb
language plpgsql set search_path='' as $$
declare organization record; staff record; clock_at timestamptz:=now(); failures integer;
 checked integer:=0; inserted integer:=0; total_failures integer:=0;
begin
 -- Cron and manual recovery cannot race one another.
 if not pg_try_advisory_xact_lock(hashtextextended('northside-hq-reminders',0)) then
  return jsonb_build_object('skipped',true);
 end if;
 for organization in select distinct org_id from private.staff_access where active loop
  failures:=0;
  for staff in
   select s.id from private.staff_access s
   join auth.users u on lower(u.email)=lower(s.email) and u.email_confirmed_at is not null
   where s.org_id=organization.org_id and s.active
    and exists(select 1 from private.agreement_documents d where d.org_id=s.org_id and d.active and d.effective_date<=(clock_at at time zone 'America/Chicago')::date)
    and not exists(
     select 1 from private.agreement_documents d
     where d.org_id=s.org_id and d.active and d.effective_date<=(clock_at at time zone 'America/Chicago')::date
      and not exists(select 1 from private.agreement_acceptances a where a.agreement_id=d.id and a.user_id=u.id and a.document_hash=d.document_hash)
    )
  loop
   begin
    inserted:=inserted+private.hq_reminders(organization.org_id,staff.id,clock_at);
    checked:=checked+1;
   exception when others then
    -- Keep one malformed record from stopping reminders for the rest of the team.
    failures:=failures+1;
   end;
  end loop;
  insert into private.hq_reminder_runs(org_id,checked_at,completed_at,failed_staff)
  values(organization.org_id,clock_at,case when failures=0 then clock_at else null end,failures)
  on conflict(org_id) do update set checked_at=excluded.checked_at,
   completed_at=coalesce(excluded.completed_at,private.hq_reminder_runs.completed_at),failed_staff=excluded.failed_staff;
  total_failures:=total_failures+failures;
 end loop;
 return jsonb_build_object('checked',checked,'inserted',inserted,'failures',total_failures);
end $$;
revoke all on function private.hq_refresh_reminders() from public,anon,authenticated,service_role;

-- Only a gated staff member can read their organization's limited scheduler status.
create or replace function public.hub_reminder_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); result jsonb;
begin
 select jsonb_build_object('active',
   exists(select 1 from cron.job where jobname='hq-deadline-reminders' and active)
   and r.failed_staff=0 and r.completed_at>now()-interval '15 minutes',
  'lastCheckedAt',r.completed_at,'emailEnabled',false)
 into result from private.hq_reminder_runs r where r.org_id=w;
 return coalesce(result,jsonb_build_object('active',false,'lastCheckedAt',null,'emailEnabled',false));
end $$;
revoke all on function public.hub_reminder_status() from public,anon,authenticated,service_role;
grant execute on function public.hub_reminder_status() to authenticated;

-- One named job: reapplying the migration updates its schedule, never duplicates it.
select cron.schedule('hq-deadline-reminders','*/5 * * * *','select private.hq_refresh_reminders();');
commit;
