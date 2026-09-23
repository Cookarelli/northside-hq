# Michael Jordan consignment reminders

The existing Michael Jordan campaign now belongs to the existing **Collect Weekly Auctions** project. The migration reuses all three deliverable IDs and preserves their production and publishing workflows. It does not create another project, calendar record, or asset copy.

| Deliverable | Existing ID | Due and target publication, America/Chicago |
| --- | --- | --- |
| Michael Jordan Auction — 48 Hour Reminder | `mj-consignment-video-48h` | Friday, September 25, 2026, 9:00 PM |
| Michael Jordan Auction — 24 Hour Reminder | `mj-consignment-video-24h` | Saturday, September 26, 2026, 9:00 PM |
| Michael Jordan Auction — 2 Hour Reminder | `mj-consignment-video-2h` | Sunday, September 27, 2026, 7:00 PM |

All three retain Jon as accountable owner, Steve and Brody as contributors, and Steve as publisher. Status remains To do; previously unspecified priority is Normal. The campaign/batch reference is **Michael Jordan Consignment**. Original creation timestamps, individual briefs, captions, assets, references, assignment metadata, and publication plans are preserved. No MJ asset or lot link existed in production at migration time, so none is invented or copied from the unrelated LeBron lot.

## Architecture and preservation

Continue using the existing `marketing_records` project and deliverable kinds. Deliverables use `projectId`, `owner`, `contributors`, `productionDue`, `publishAt`, `priority`, `notes`, `assets`, `references`, `destinationUrl`, `createdAt`, and `updatedAt`. Add campaign context fields (`campaignReference`, `campaignBrief`, `campaignAuction`, `auctionClosesAt`, `reminderHours`, `sourceProjectId`) without replacing the normal forms or permission checks. Save operations merge historical JSON fields, preserving the new context.

The original project remains at `/projects/mj-consignment-video-2026-09-23`, with status Archived and a `migratedToProjectId` reference. Its original JSON is retained in `migrationSnapshot`, and each deliverable retains its before-migration record and source-project snapshot in `campaignMigration`. Existing comments, activity and uploaded assets remain at their original IDs. Deliverables link to the original campaign's notes/history. The app displays the migrated state and links to the parent and the three work items, hides the migrated project from the default project list and removes its obsolete project-level calendar entry. The archive remains accessible through the Archived filter or its original URL.

The parent is resolved by its existing name, accepting the original singular spelling **Collect Weekly Auction**, which is renamed to the requested plural spelling. Its current brief, owner, members, budget, allocations, links, unrelated deliverables, and auction dates remain unchanged. Its separately entered auction close was Saturday, September 26 at 9:30 PM; the MJ campaign's own exact Sunday timestamp is used for these reminders.

## Scheduling and migration safety

`20260923204847_mj_consignment_deliverables.sql` was applied to the existing Supabase project on September 23, 2026. Its filename matches the migration version recorded by Supabase. Do not reset or reseed production, replay baseline migrations, or repair older migration history as part of this change.

The transaction locks the workspace with the same advisory lock used by existing mutations, then reads current data. An exact campaign close takes priority, followed by the saved parent close. Offset timestamps are parsed as instants; timezone-free timestamps are interpreted in America/Chicago. Exact timestamps use elapsed 48, 24, and 2 hours, including daylight-saving transitions. If neither close exists, the campaign's creation week selects Sunday and the Friday/Saturday 9 PM and Sunday 7 PM wall-clock schedule. A non-Sunday saved close stops the migration for review.

The migration refuses missing/ambiguous parents, unrelated ID collisions, deleted/task-workflow reminders, and already scheduled/published reminders. It preserves original approval information in the before-migration snapshot and clears the current approval/submission after moving a deliverable to a different project owner. Existing Ready work returns to Needs review. Production's three reminders were all To do with planned publications.

The source migration marker makes reapplication a no-op, including versions, update timestamps, activity and notifications. Stable IDs also ensure missing reminders are created only once. A private invoker trigger prevents old clients or seed logic from reactivating the archived project or attaching deliverables back to it. Existing RLS, authentication, NDA gates, staff permissions and storage policies are unchanged.

## Verification

- 124 tests pass, including six database migration tests covering preservation, exact timing, DST, fallback timing, missing reminders, full replay, stale seed protection, atomic rollback, and anonymous access.
- Typecheck and production build pass. Lint has zero errors and four pre-existing warnings in unrelated files.
- Isolated local browser checks confirm the parent project lists the three reminders, work details display the correct Central due/publish/close times and original timestamps, and the old route displays Migrated / Archived with links and no project-editing controls. Mobile archive view has no horizontal overflow or error overlay.
- Live verification: record count remains 29; unrelated-record and comment checksums match the pre-migration baseline. Parent fields other than title/version/update timestamp are preserved. All three original deliverable IDs now reference the existing parent.
- Security advisor output is unchanged: private tables intentionally lack direct client policies; the pre-existing [leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains outside this migration's scope.

The data migration is live. The interface changes in this branch still require review and application deployment. Roll back the app if necessary while retaining the additive migration and migrated data; do not delete the archived source or reminder records.
