# Project ownership, assignments and scheduled deliverables

Projects now separate one primary owner from assigned staff. Owner choices reuse the existing staff roster: Consignment → Brody, Nik → `nikb`, CEO → Joey, and Nick/Zach/Jon/Steve → their existing IDs. Existing owners remain editable without rewriting historical records. New projects require an owner; existing incomplete drafts are preserved.

The searchable staff picker supports adding and removing multiple people. Project cards and project pages display these assignments separately from the owner. Deliverables have their own assignees; project membership alone does not assign every deliverable.

Use **Add deliverable** inside a project for scheduled tasks, including optional closing windows. Tasks have a description, Central due date/time, optional end date/time, assignees, four statuses, priority, notes, and a server-recorded completion timestamp. Completion time clears when reopened. Existing publishing work retains its approval and confirmed-publication workflow through **Add publishing work**.

The HQ calendar reads the same canonical deliverable record. Rescheduling changes its calendar entry; deleting hides it without creating or deleting a separate calendar record. Deletion is recoverable from the project's **Deleted deliverables** section. Confirmed publishing records cannot be removed this way.

**My Assignments** includes assigned work, approval requests, unblock requests, and active projects, with All / Due today / Due this week / Overdue filters. Work sorts by priority and then due date. Week filters use Monday–Sunday in Central time.

## Data and permissions

- Extend `marketing_records` project/deliverable JSON instead of adding parallel project, staff, assignment, or calendar tables.
- Reuse `owner` and `members` for project ownership/assignments; `owner` and `contributors` for task assignees; `productionDue` for the calendar schedule.
- Optional task metadata: `workflow`, `waiting`, `endAt`, `priority`, `notes`, `completedAt`, `deletedAt`, `deletedBy`. Legacy priority defaults to Normal in the UI. Unknown historical completion times are not fabricated.
- Add `hub_project_tasks` and a private handler, plus a trigger enforcing task rules through older endpoints. Update deadline reminder generation to skip deleted deliverables while retaining notification history.
- Staff identities are validated against active, same-workspace `private.staff_access` records. Existing JSON references cannot use ordinary column foreign keys; no duplicate identity table is introduced.
- Project owners/admins manage task details, assignees and schedules. Assigned staff can change task status. Existing project members can create self-assigned tasks; assigning others requires the owner/admin.
- Existing project creation/editing, request coordination, budgets, publishing approval, auth, NDA gating, and workspace read permissions remain in place. The new endpoint calls the same staff/agreement gate. No RLS policy is broadened.
- Migration is transactional and safe to reapply. It does not rewrite or delete existing data or backfill responsibility to an arbitrary user.

## Migration and release

Apply `supabase/migrations/20260923165617_project_tasks_assignments.sql` before deploying the updated app. Applied to production on September 23, 2026, recorded as version `20260923165617`. Existing record counts and checksums were verified unchanged; the NDA gate and anonymous-access restrictions were verified intact. The commands below are for other environments or future recovery, not a request to reapply production.

From the repository checkout, with Supabase CLI authenticated:

```sh
supabase link --project-ref yogdhpfattuxicwyxylb
supabase db push --linked --dry-run --skip-vault
```

Check that the pending list contains only the intended new migration. If it lists old baseline migrations, reconcile migration history before proceeding; do not use `--include-all` or replay baseline SQL against production.

When the pending list is correct:

```sh
supabase db push --linked --skip-vault
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The SQL file can also be applied as one transaction in the Supabase SQL Editor; record that version as applied in migration history before future CLI pushes. Do not run a database reset or seed production. After applying, deploy the app and verify an existing project, new deliverable, reschedule, assignment completion, calendar removal/restore, and NDA gating with appropriate test accounts.

If application rollback is necessary, roll back the app while retaining the additive database migration and all task records. Do not remove the task permission trigger while task records exist.

## Verification

86 tests pass, including canonical calendar entries, Central-date filters, assignment permissions, stale-write rejection, inactive/foreign/anonymous access, NDA gating, server timestamps, notification recipients, recoverable deletion, and migration replay preserving populated records/activity/notifications. Lint passes with four pre-existing warnings; typecheck and production build pass.

New UI components: `StaffPicker`, `ProjectTaskForm`, `TaskActions`, `DeliverableDetails`, and `MyAssignments`. Updated existing project, dashboard, schedule, calendar, and API components use the shared helpers in `lib/project-tasks.ts`.

The initial interface walkthrough was blocked by Chrome. Browser access is now restored for deployment verification. The earlier calendar-only change had a separate fixture walkthrough; that result does not verify the new task forms. No production records were edited during implementation.

## Deployment repair

Vercel reported a missing client-reference manifest for `app/(hq)/page.tsx`. Both that page and `app/page.tsx` resolved to `/`. Remove the duplicate route and keep the existing root redirect to `/today`; the `/today` route continues through the unchanged auth and NDA-gated HQ layout.
