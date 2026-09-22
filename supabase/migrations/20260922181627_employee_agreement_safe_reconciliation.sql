-- Additive hardening. Run after the two agreement migrations; never replay HQ setup.
-- No employee/staff/marketing rows are rewritten or removed.
alter table private.agreement_documents enable row level security;
alter table private.agreement_assignments enable row level security;
alter table private.agreement_acceptances enable row level security;
revoke all on private.agreement_documents,private.agreement_assignments,private.agreement_acceptances from public,anon,authenticated;

-- Identity remains available to the signing flow while operational access is gated.
create or replace function private.agreement_staff_workspace() returns text
language sql stable security definer set search_path='' as $$
 select a.org_id from private.staff_access a join auth.users u on lower(u.email)=a.email
 where u.id=(select auth.uid()) and u.email_confirmed_at is not null and a.active
$$;
create or replace function private.agreement_require_staff() returns text
language plpgsql security definer set search_path='' as $$
declare w text;
begin
 select a.org_id into w from private.staff_access a join auth.users u on lower(u.email)=a.email
 where u.id=(select auth.uid()) and u.email_confirmed_at is not null and a.active for share of a;
 if w is null then raise exception using errcode='42501',message='Staff access required.'; end if;
 return w;
end $$;

create or replace function private.agreement_access_allowed(w text) returns boolean
language sql stable security definer set search_path='' as $$
 select w is not null and w=private.agreement_staff_workspace()
 and exists(select 1 from private.agreement_documents d where d.org_id=w and d.active and d.effective_date<=(now() at time zone 'America/Chicago')::date)
 and not exists(
  select 1 from private.agreement_documents d
  where d.org_id=w and d.active and d.effective_date<=(now() at time zone 'America/Chicago')::date
   and not exists(select 1 from private.agreement_acceptances a where a.agreement_id=d.id and a.user_id=auth.uid() and a.document_hash=d.document_hash)
 )
$$;

create or replace function private.agreement_gate() returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.agreement_require_staff(); uid uuid:=auth.uid(); staff private.staff_access; doc private.agreement_documents; assignment private.agreement_assignments;
begin
 select a.* into strict staff from private.staff_access a join auth.users u on lower(u.email)=a.email where u.id=uid and a.org_id=w and a.active;
 if not exists(select 1 from private.agreement_documents d where d.org_id=w and d.active and d.effective_date<=(now() at time zone 'America/Chicago')::date) then
  raise exception using errcode='55000',message='Agreement setup required. Contact your administrator.';
 end if;
 for doc in select * from private.agreement_documents d
 where d.org_id=w and d.active and d.effective_date<=(now() at time zone 'America/Chicago')::date
 order by d.effective_date,d.created_at,d.id loop
  if exists(select 1 from private.agreement_acceptances a where a.agreement_id=doc.id and a.user_id=uid and a.document_hash=doc.document_hash) then continue; end if;
  insert into private.agreement_assignments(agreement_id,user_id,staff_id,provided_at,review_due_at)
  values(doc.id,uid,staff.id,now(),now()) on conflict(agreement_id,user_id) do update
  set review_due_at=agreement_assignments.provided_at,deferred_until=null;
  select * into strict assignment from private.agreement_assignments a where a.agreement_id=doc.id and a.user_id=uid;
  return jsonb_build_object('required',true,'hardGate',true,'agreementId',doc.id,'title',doc.title,'version',doc.version,'storagePath',doc.storage_path,'documentHash',doc.document_hash,'effectiveDate',doc.effective_date,'employeeName',staff.name,'employeeEmail',staff.email,'employeeTitle',staff.title,'providedAt',assignment.provided_at);
 end loop;
 return jsonb_build_object('required',false);
end $$;

create or replace function private.accept_agreement(p_agreement_id uuid,p_full_name text,p_ip text,p_user_agent text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.agreement_require_staff(); uid uuid:=auth.uid(); staff private.staff_access; doc private.agreement_documents; accepted private.agreement_acceptances;
begin
 select a.* into strict staff from private.staff_access a join auth.users u on lower(u.email)=a.email where u.id=uid and a.org_id=w and a.active;
 select * into doc from private.agreement_documents d where d.id=p_agreement_id and d.org_id=w and d.active and d.effective_date<=(now() at time zone 'America/Chicago')::date for share;
 if not found then raise exception using errcode='P0002',message='Agreement unavailable.'; end if;
 perform 1 from private.agreement_assignments a where a.agreement_id=doc.id and a.user_id=uid for update;
 if not found then raise exception using errcode='22023',message='Agreement must be provided before acceptance.'; end if;
 if coalesce(length(btrim(p_full_name)),0)<2 or lower(btrim(p_full_name)) is distinct from lower(btrim(staff.name)) then
  raise exception using errcode='22023',message='Type your full name exactly as shown.';
 end if;
 insert into private.agreement_acceptances(agreement_id,user_id,staff_id,full_name,email,ip_address,user_agent,document_hash)
 values(doc.id,uid,staff.id,staff.name,staff.email,nullif(btrim(coalesce(p_ip,'')),'')::inet,left(coalesce(p_user_agent,''),1000),doc.document_hash)
 on conflict(agreement_id,user_id) do nothing;
 select * into strict accepted from private.agreement_acceptances a where a.agreement_id=doc.id and a.user_id=uid;
 if accepted.document_hash<>doc.document_hash then raise exception using errcode='55000',message='Agreement version changed. Contact your administrator.'; end if;
 return jsonb_build_object('ok',true,'acceptedAt',accepted.accepted_at);
end $$;

-- Append-only acceptance records, including accidental privileged updates/deletes.
create or replace function private.agreement_acceptance_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='Agreement acceptance history is immutable.'; end $$;
drop trigger if exists agreement_acceptance_immutable on private.agreement_acceptances;
create trigger agreement_acceptance_immutable before update or delete on private.agreement_acceptances for each row execute function private.agreement_acceptance_immutable();

-- Do not replace the controlled document behind an existing assignment/signature.
create or replace function private.agreement_document_immutable() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (new.org_id,new.version,new.storage_path,new.document_hash,new.title,new.effective_date) is distinct from (old.org_id,old.version,old.storage_path,old.document_hash,old.title,old.effective_date)
 and exists(select 1 from private.agreement_assignments a where a.agreement_id=old.id) then
  raise exception using errcode='42501',message='Create a new agreement version; the provided document is immutable.';
 end if;
 return new;
end $$;
drop trigger if exists agreement_document_immutable on private.agreement_documents;
create trigger agreement_document_immutable before update on private.agreement_documents for each row execute function private.agreement_document_immutable();

-- A definer predicate permits signed URLs without granting access to private tables.
create or replace function private.agreement_document_visible(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.agreement_documents d where d.org_id=private.agreement_staff_workspace() and d.active and d.storage_path=path and d.effective_date<=(now() at time zone 'America/Chicago')::date)
$$;
drop policy if exists agreement_document_read on storage.objects;
create policy agreement_document_read on storage.objects for select to authenticated
using(bucket_id='employee-agreements' and private.agreement_document_visible(name));

-- All existing operational RPCs already call require_staff. Existing RLS uses workspace.
-- Preserve both signatures and every existing policy, adding only the agreement predicate.
create or replace function private.require_staff() returns text
language plpgsql security definer set search_path='' as $$
declare w text:=private.agreement_require_staff();
begin
 if not private.agreement_access_allowed(w) then raise exception using errcode='42501',message='Agreement signature required before accessing Northside HQ.'; end if;
 return w;
end $$;
create or replace function private.workspace() returns text
language sql stable security definer set search_path='' as $$
 select w from (select private.agreement_staff_workspace() w) staff where private.agreement_access_allowed(w)
$$;
-- Context is identity only: sign-in and the signature screen must remain reachable.
create or replace function public.hub_context() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('orgId',private.agreement_staff_workspace(),'userId',auth.uid(),'orgName','Northside Collectibles','role',private.staff_role())
$$;

-- No defer RPC exists after the immediate-gate migration. Never recreate one here.
revoke all on function private.agreement_staff_workspace(),private.agreement_require_staff(),private.agreement_access_allowed(text),private.agreement_gate(),private.accept_agreement(uuid,text,text,text),private.agreement_document_visible(text),private.agreement_acceptance_immutable(),private.agreement_document_immutable() from public,anon,authenticated;
grant execute on function private.agreement_staff_workspace(),private.agreement_access_allowed(text),private.agreement_gate(),private.accept_agreement(uuid,text,text,text),private.agreement_document_visible(text) to authenticated;
revoke all on function public.hub_agreement_gate(),public.hub_accept_agreement(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.hub_agreement_gate(),public.hub_accept_agreement(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
