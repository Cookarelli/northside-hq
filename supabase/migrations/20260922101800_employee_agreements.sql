-- Versioned employee agreement gate for Northside HQ.
-- Keeps agreement records immutable and supports the 14-day review period
-- stated in Northside's restrictive covenant agreement.

create table if not exists private.agreement_documents (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  version text not null,
  title text not null,
  storage_path text not null,
  document_hash text not null check (document_hash ~ '^[A-Fa-f0-9]{64}$'),
  effective_date date not null,
  review_days integer not null default 14 check (review_days between 0 and 60),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (org_id, version)
);

create table if not exists private.agreement_assignments (
  agreement_id uuid not null references private.agreement_documents(id),
  user_id uuid not null references auth.users(id),
  staff_id text not null,
  provided_at timestamptz not null default now(),
  review_due_at timestamptz not null,
  deferred_until timestamptz,
  primary key (agreement_id, user_id)
);

create table if not exists private.agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references private.agreement_documents(id),
  user_id uuid not null references auth.users(id),
  staff_id text not null,
  full_name text not null,
  email text not null,
  accepted_at timestamptz not null default now(),
  ip_address inet,
  user_agent text not null default '',
  document_hash text not null,
  unique (agreement_id, user_id)
);

revoke all on private.agreement_documents, private.agreement_assignments, private.agreement_acceptances
from public, anon, authenticated;

create index if not exists agreement_documents_active
  on private.agreement_documents(org_id, active, effective_date desc);
create index if not exists agreement_assignments_user
  on private.agreement_assignments(user_id, review_due_at);
create index if not exists agreement_acceptances_user
  on private.agreement_acceptances(user_id, accepted_at desc);

create or replace function private.agreement_gate()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  w text:=private.require_staff();
  uid uuid:=auth.uid();
  staff private.staff_access;
  doc private.agreement_documents;
  assignment private.agreement_assignments;
  acceptance private.agreement_acceptances;
begin
  select a.* into staff
  from private.staff_access a
  join auth.users u on lower(u.email)=a.email
  where u.id=uid and a.org_id=w and a.active;

  if not found then
    raise exception using errcode='42501', message='Staff access required.';
  end if;

  for doc in
    select *
    from private.agreement_documents d
    where d.org_id=w and d.active and d.effective_date<=current_date
    order by d.effective_date, d.created_at
  loop
    select * into acceptance
    from private.agreement_acceptances x
    where x.agreement_id=doc.id and x.user_id=uid;

    if found then
      continue;
    end if;

    insert into private.agreement_assignments(
      agreement_id,user_id,staff_id,provided_at,review_due_at
    )
    values(
      doc.id,uid,staff.id,now(),now()+make_interval(days=>doc.review_days)
    )
    on conflict(agreement_id,user_id) do nothing;

    select * into assignment
    from private.agreement_assignments a
    where a.agreement_id=doc.id and a.user_id=uid;

    if assignment.deferred_until is not null and assignment.deferred_until>now() then
      continue;
    end if;

    return jsonb_build_object(
      'required',true,
      'agreementId',doc.id,
      'title',doc.title,
      'version',doc.version,
      'storagePath',doc.storage_path,
      'documentHash',doc.document_hash,
      'effectiveDate',doc.effective_date,
      'employeeName',staff.name,
      'employeeEmail',staff.email,
      'employeeTitle',staff.title,
      'providedAt',assignment.provided_at,
      'reviewDueAt',assignment.review_due_at,
      'hardGate',assignment.review_due_at<=now()
    );
  end loop;

  return jsonb_build_object('required',false);
end
$$;

create or replace function private.accept_agreement(
  p_agreement_id uuid,
  p_full_name text,
  p_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  w text:=private.require_staff();
  uid uuid:=auth.uid();
  staff private.staff_access;
  doc private.agreement_documents;
  assignment private.agreement_assignments;
begin
  select a.* into staff
  from private.staff_access a
  join auth.users u on lower(u.email)=a.email
  where u.id=uid and a.org_id=w and a.active;

  if not found then
    raise exception using errcode='42501', message='Staff access required.';
  end if;

  select * into doc
  from private.agreement_documents d
  where d.id=p_agreement_id and d.org_id=w and d.active
  for share;

  if not found then
    raise exception using errcode='P0002', message='Agreement unavailable.';
  end if;

  select * into assignment
  from private.agreement_assignments a
  where a.agreement_id=doc.id and a.user_id=uid
  for update;

  if not found then
    raise exception using errcode='22023', message='Agreement must be provided before acceptance.';
  end if;

  if lower(btrim(p_full_name)) is distinct from lower(btrim(staff.name)) then
    raise exception using errcode='22023', message='Type your full name exactly as shown.';
  end if;

  insert into private.agreement_acceptances(
    agreement_id,user_id,staff_id,full_name,email,ip_address,user_agent,document_hash
  )
  values(
    doc.id,uid,staff.id,staff.name,staff.email,
    nullif(btrim(coalesce(p_ip,'')),'')::inet,
    left(coalesce(p_user_agent,''),1000),
    doc.document_hash
  )
  on conflict(agreement_id,user_id) do nothing;

  return jsonb_build_object('ok',true,'acceptedAt',now());
end
$$;

create or replace function private.defer_agreement(p_agreement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  w text:=private.require_staff();
  uid uuid:=auth.uid();
  assignment private.agreement_assignments;
begin
  select a.* into assignment
  from private.agreement_assignments a
  join private.agreement_documents d on d.id=a.agreement_id
  where a.agreement_id=p_agreement_id and a.user_id=uid and d.org_id=w and d.active
  for update of a;

  if not found then
    raise exception using errcode='P0002', message='Agreement unavailable.';
  end if;

  if assignment.review_due_at<=now() then
    raise exception using errcode='22023', message='The review period has ended. Acceptance is now required.';
  end if;

  update private.agreement_assignments
  set deferred_until=review_due_at
  where agreement_id=p_agreement_id and user_id=uid;

  return jsonb_build_object('ok',true,'deferredUntil',assignment.review_due_at);
end
$$;

create or replace function public.hub_agreement_gate()
returns jsonb
language sql
security invoker
set search_path=''
as $$ select private.agreement_gate() $$;

create or replace function public.hub_accept_agreement(
  p_agreement_id uuid,
  p_full_name text,
  p_ip text,
  p_user_agent text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$ select private.accept_agreement(p_agreement_id,p_full_name,p_ip,p_user_agent) $$;

create or replace function public.hub_defer_agreement(p_agreement_id uuid)
returns jsonb
language sql
security invoker
set search_path=''
as $$ select private.defer_agreement(p_agreement_id) $$;

-- Private bucket for final controlled agreement PDFs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('employee-agreements','employee-agreements',false,10485760,array['application/pdf'])
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists agreement_document_read on storage.objects;
create policy agreement_document_read
on storage.objects for select to authenticated
using (
  bucket_id='employee-agreements'
  and exists (
    select 1
    from private.agreement_documents d
    where d.org_id=(select private.workspace())
      and d.storage_path=name
      and d.active
  )
);

revoke all on function private.agreement_gate(), private.accept_agreement(uuid,text,text,text),
  private.defer_agreement(uuid) from public,anon,authenticated;
grant execute on function private.agreement_gate(), private.accept_agreement(uuid,text,text,text),
  private.defer_agreement(uuid) to authenticated;

revoke all on function public.hub_agreement_gate(), public.hub_accept_agreement(uuid,text,text,text),
  public.hub_defer_agreement(uuid) from public,anon,authenticated;
grant execute on function public.hub_agreement_gate(), public.hub_accept_agreement(uuid,text,text,text),
  public.hub_defer_agreement(uuid) to authenticated;
