# Agreement repair — 22 September 2026

Target: existing Supabase project `yogdhpfattuxicwyxylb`. No reset, table drop, production fixture or acceptance was created.

## Migration diagnosis and actions

The cumulative definitions of the first nine migrations were compared with a locally reconstructed PostgreSQL catalog: 171 columns, 46 indexes, 16 policies, 9 triggers and 58 non-NOT-NULL constraints matched. All 18 existing tables had the expected RLS state. 54 of 55 function bodies matched the current repository (whitespace normalized); the only difference was `private.save_record` omitting the later `request` kind. PostgreSQL-version-specific NOT NULL catalog entries and Supabase's service-role grants were accounted for separately.

| Migration | Remote finding and action |
|---|---|
| 20260916011251 marketing_hub | Existing schema verified; not replayed |
| 20260916011429 provision_approved_staff | Public file is a no-op historical checkpoint; existing ledger left unchanged, private roster not reseeded |
| 20260916025113 content_calendar_september_2026 | Public file is a no-op historical checkpoint; ledger left unchanged, private calendar not reseeded |
| 20260917180437 consignment_campaigns | Existing schema verified; not replayed |
| 20260917180743 consignment_preserve_published_history | Current save_campaign function verified; not replayed |
| 20260919014854 northside_hq_projects_deliverables | Existing objects and cumulative definitions verified; not replayed |
| 20260919023059 northside_hq_requests_review_handoff | Existing objects and cumulative definitions verified; not replayed |
| 20260919033840 northside_hq_operations | Existing objects and definitions verified; not replayed |
| 20260919041852 northside_hq_release_verification | Existing objects and definitions verified; not replayed |
| 20260921193000 requests_notes | Incorrectly recorded as applied; remote save_record did not contain this change. False ledger entry removed. This migration remains pending; no request records rewritten. |
| 20260922101800 employee_agreements | Incorrectly recorded as applied with all agreement tables/functions missing. Ledger corrected, SQL actually executed, then recorded after verification in the same transaction. |
| 20260922113000 employee_agreements_immediate_gate | Same false-history condition; actually executed and then recorded in the same transaction. |
| 20260922181627 employee_agreement_safe_reconciliation | Applied additive security hardening together with the agreement schema. |
| 20260922181841 employee_agreement_created_by_index | Applied the covering index recommended by the performance advisor. |

The repair transaction checked fingerprints of all 55 existing function bodies before making changes. It corrected only the three false migration ledger rows, executed the original agreement migrations followed immediately by hardening, verified required objects, then recorded the executed agreement versions. The base migration's temporary defer function was never committed as an available endpoint. Existing row-count and content fingerprints across all 18 pre-existing tables were identical before and after.

## Enforced behavior

- `agreement_documents`, `agreement_assignments`, and `agreement_acceptances` exist in `private`, with RLS enabled and no direct employee table privileges.
- `hub_agreement_gate()` and `hub_accept_agreement(uuid,text,text,text)` exist. No defer RPC remains.
- Operational RPC authorization and existing workspace RLS also enforce the gate, so calling data endpoints directly cannot bypass the page.
- Auth identity/context and controlled PDF access remain available for signing. The storage policy uses a checked definer predicate rather than requiring employees to read private document tables.
- Acceptance records use authenticated roster identity, controlled document hash and server `now()` timestamps. Idempotent retries return the original stored timestamp.
- Employees cannot insert, update, delete or truncate acceptance records directly. An immutable-history trigger also rejects accidental row updates/deletes by privileged code.
- Changing the controlled document identity after assignment is rejected; publish a new document version instead.
- Missing agreement configuration or verification errors fail closed. No continue-later action exists.

## Checks

Local PostgreSQL tests cover an existing populated HQ database, unsigned operational/RLS denial, PDF access, ignored deferral dates, invalid names, server timestamps, idempotent acceptance, preserved records, immutable history, foreign/disabled staff and anonymous denial. Full tests, typecheck, lint and build are run with the app changes.

Security advisors after the repair report no new warning/error: RLS-without-policy notices are intentional for RPC-only private tables. The existing warning is disabled leaked-password protection: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . The new unindexed created_by foreign key was fixed. Unused-index notices are informational for this small/new dataset.

## Still required

There are zero agreement documents and zero acceptance records. An administrator must upload the approved PDF to the private `employee-agreements` bucket and register its exact SHA-256 hash, version, workspace, storage path and effective date. Activate only the approved document. Do not insert a synthetic signature, placeholder agreement, or reset staff passwords as part of this migration.

The live application's public bundle was found to point to `sjbjotfzsnaolecxklxr`, a different database. Do not silently change that connection. Confirm the intended production target before publishing the agreement application changes or changing public Supabase configuration.

Do not run `db reset`, blindly mark migrations applied, or replay the initial HQ setup. The unapplied Requests/Notes migration must remain pending until separately reviewed/executed. `scripts/verify-agreement-schema.sql` is a read-only follow-up verification query.
