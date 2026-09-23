begin;
-- Keep privileged reads outside the exposed API schema; both layers retain the staff/NDA gate.
create or replace function private.hq_reminder_status() returns jsonb
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
revoke all on function private.hq_reminder_status() from public,anon,authenticated,service_role;
grant execute on function private.hq_reminder_status() to authenticated;

create or replace function public.hub_reminder_status() returns jsonb
language sql security invoker set search_path='' as $$
 select private.hq_reminder_status()
$$;
revoke all on function public.hub_reminder_status() from public,anon,authenticated,service_role;
grant execute on function public.hub_reminder_status() to authenticated;
commit;
