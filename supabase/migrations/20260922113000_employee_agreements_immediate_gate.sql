-- Make the Northside HQ employee agreement an immediate hard gate.
-- This is a follow-up migration so it is safe whether the original agreement
-- migration has already been applied or is applied in the same deployment.

alter table private.agreement_documents
  alter column review_days set default 0;

update private.agreement_documents
set review_days=0
where active;

update private.agreement_assignments
set review_due_at=provided_at,
    deferred_until=null
where exists (
  select 1
  from private.agreement_documents d
  where d.id=agreement_assignments.agreement_id
    and d.active
);

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
      doc.id,uid,staff.id,now(),now()
    )
    on conflict(agreement_id,user_id) do update
      set review_due_at=excluded.review_due_at,
          deferred_until=null;

    select * into assignment
    from private.agreement_assignments a
    where a.agreement_id=doc.id and a.user_id=uid;

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
      'hardGate',true
    );
  end loop;

  return jsonb_build_object('required',false);
end
$$;

drop function if exists public.hub_defer_agreement(uuid);
drop function if exists private.defer_agreement(uuid);

revoke all on function private.agreement_gate() from public,anon,authenticated;
grant execute on function private.agreement_gate() to authenticated;
