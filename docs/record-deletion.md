# Project and deliverable deletion

Delete is available on project and deliverable detail pages, including migrated project history pages. The shared confirmation dialog names the saved item. Project confirmation counts every non-deleted deliverable, including completed and published work, and prevents deletion until each is individually deleted or moved. The dialog links to the project's deliverables; existing editing and move permissions still apply.

## Permission decision

The existing model separates the accountable `owner`, project members/contributors, creator, and the `admin` role in `private.staff_access`. Previously, `task-delete` used project-manager permissions and ordinary publishing deliverables and projects had no Delete action.

Deletion now permits the item owner or a workspace administrator. As with existing project editing, an historical unowned record can be deleted by its creator. Being a contributor, publisher, project member, or the owner of the parent project alone does not permit deleting another person's deliverable. The legacy task-delete RPC uses the same checked deletion path, so an older client cannot retain broader deletion rights. Other task editing and recovery permissions are unchanged.

The database obtains the organization and staff ID from verified, active membership through `private.require_staff()` / `private.hq_staff_id()`, including the existing agreement gate. The public RPC is security invoker and the checked implementation lives in the private schema. Anon/PUBLIC execution is revoked. There are no new table write grants, RLS bypasses for clients, or trusted client actor/role fields.

## Transaction and retention

`public.hub_hq_delete` validates confirmation, ID and version, takes the existing workspace transaction lock, verifies ownership/admin permission, and checks attached deliverables before changing anything. A server-owned `deletedAt` / `deletedBy` marks the canonical row; `version` increments. `hq_activity` captures the item kind, ID, original title and full snapshot, staff actor, and server timestamp in the same transaction. Retrying a completed deletion returns its original result without duplicating audit events.

A guard covers older writers and prevents new work, moves, auction edits, or restoration from attaching to a deleted project. Completed/published deliverables also block project deletion. The workspace lock serializes deletion with existing creation, movement and recovery RPCs. A stale confirmation requires reloading and reconfirming; the dialog keeps the original name/version while open.

The existing soft-delete retention model is extended:

- Canonical records and IDs remain. Nothing is physically purged, and there is no retention timer or backfill.
- Asset records, immutable private storage objects, external references, assignments and media review/publication evidence remain. Old file and accepted-request links still reach a retained record.
- Comments and all audit snapshots remain readable. Deleted details do not accept new comments or ordinary edits.
- Approved budgets, actual spend, channel ledger entries and reversals remain. Project spending totals retain historical expenses. Auction operational rollups continue excluding deleted work under the existing behavior; the original ledger remains accessible from the retained record and project spending history.
- Notifications remain in history but all unresolved notifications for the deleted item are resolved immediately. Deadline generation already excludes deleted rows.
- Legacy adoption links remain intact so deleting an adopted deliverable does not revive its original calendar post.
- Accepted-request and migrated-project links open deleted deliverables' retained detail pages. Older parent-project bookmarks show a link to the deleted deliverable's history.
- The existing deliverable recovery action remains available to project managers/admins while the parent is not deleted. Project recovery is not added. Restoring a child of a deleted project is blocked.

Published and scheduled evidence is preserved, so deletion can remove these items from HQ's active views. This replaces the old task-delete prohibition on confirmed publications. A scheduled-item confirmation explains that deleting from HQ does not cancel external platform schedules; publishing remains manual.

## Screen updates

A successful response replaces the local record with the retained deleted record immediately, without waiting for a second network read, and displays a named success message. Existing workspace events/BroadcastChannel refresh other open views; other sessions use the app's existing focus/poll refresh. Project lists now also subscribe to record-change refreshes. Calendar dates, schedules, dashboards, assignment lists, checklist groups, project choices and asset-assignment choices exclude deleted work. Direct URLs retain read-only history screens with working file/comment/spend links.

Failures remain in the confirmation dialog with the server's actionable explanation and retry/reload controls. Cancel and Escape do not send a mutation; pending requests prevent double submission.

## Migration and rollout

New migration: `supabase/migrations/20261002134057_hq_record_deletion.sql` (filename generated by the installed Supabase CLI).

1. Review the change and verify the target migration history through `20260924183335_direct_media_review.sql`, applying only genuinely pending prerequisites in their existing order. Do not reset or seed a production database.
2. When rollout is approved, apply this migration before deploying the UI/API that calls `hub_hq_delete`. It creates/replaces checked functions and triggers, without modifying existing records or storage. Replaying it preserves data and audit history. Like the existing media migration, it acquires Auth and record-table locks together with bounded retries before trigger DDL to avoid deadlocks with active requests.
3. Verify the target from Vercel's current production configuration; older deployment documents may name a historical database. Run advisors and hosted checks, then follow the repository's production approval process. Local test results alone do not confirm deployment.

The current database's history omits `20260921193000_requests_notes.sql`; its `private.save_record` definition has been superseded by the applied media migration. Do not use `--include-all` to replay it over the newer function. For this rollout, use a migration-only working directory containing the verified applied history and this new migration, and confirm `db push --dry-run` lists only `20261002134057_hq_record_deletion.sql`.

There is no automatic destructive down migration: retained records and audit history must survive an application rollback. Do not simply remove the database guards after users have deleted projects.

## Verification

Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build`.

Focused tests:

- `tests/hq-deletion.test.mjs`: real migrated PGlite/Postgres RPCs, real HQ HTTP handler and storage identity checks with a test transport; owner/admin and denied roles, organization boundaries, active/verified/agreement gates, direct-table denial, strict confirmation, stale versions, repeat requests, linked completed/published work, moving work, old task RPCs, restoration, both serialized create/delete orderings, project review invalidation, retained files/comments/notifications/spend, channel ledger retention, migration replay, and all active-view selectors.
- `tests/hq-delete-dialog.test.mjs`: actual React/Radix dialog with Testing Library and JSDOM; named confirmation, Cancel focus, Cancel/Escape, linked counts and review link, duplicate-click prevention, frozen confirmation version/name, error/reload handling, unauthorized and deleted-item visibility.
- `tests/helpers/hq-api.mjs`: substitutes only Supabase transport while exercising the real route and identity/origin validation.

The browser check uses a separate local copy, fictional in-memory migrated data and a local test identity; production authentication and APIs are unchanged in the implementation. It verifies blocked-project confirmation, successful deliverable and empty-project deletion, immediate success/history screens, updated notification counts, calendar removal, and browser errors. PGlite's existing test harness models Auth/Storage/cron; it does not replace a hosted Supabase integration/advisor check or a multi-connection PostgreSQL load test.
