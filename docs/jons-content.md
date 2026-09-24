# Jon's Content

Assets → Jon's Content (`/assets?tab=jons-content`) uses the existing URL tab navigation. The page has a visible Upload Content button, eight newest uploads in a compact horizontal strip, and a complete newest-first history with filename/title search and All / Unassigned / Assigned filters.

Uploads from this tab receive `collection: "jons-content"` in their existing `marketing_records` asset data. Known historical Jon uploads remain included (`uploadedBy` or historical `owner` equal to `jon`). Files merely attached to work assigned to Jon no longer determine collection membership. Reassigning content therefore cannot make it disappear from its upload history. The All Assets view includes these same records.

The existing private `marketing-assets` bucket, signed upload tickets, byte/metadata finalization checks, asset IDs and 40 MB limit are reused. Supported types include JPG, PNG, WebP, GIF, SVG, MP4, MOV, WebM, PDF, Word, Excel, PowerPoint, TXT and CSV. The server returns downloads for formats that should not be rendered directly as an active document, including SVG and Office formats; image/video/PDF links can be opened in the browser. Browser MIME fallbacks support empty or generic Office/CSV MIME types. No new bucket, table, role or duplicate file is created.

## Assignment

Each file offers Preview and Assign / Change assignment. The editor has optional searchable project and deliverable selectors; choosing a project filters deliverables. A selected deliverable supplies its actual parent project. A file can remain unassigned, belong to a project only, or belong to a deliverable and its project. Existing standalone deliverables also work. Clear assignment followed by Done removes the reference while retaining upload and assignment audit metadata.

The existing asset JSON holds `name`, optional `title` and `note`, `uploadedBy`, `uploadedAt`/`createdAt`, `assignedProjectId`, `assignedDeliverableId`, `assignedBy`, `assignedAt`, and `assignmentVersion`. Actor and timestamp fields come from PostgreSQL, not client claims. The checked `hub_assign_asset` command verifies current staff/NDA access, organization membership of destinations, deleted/migrated destinations, project/deliverable consistency and assignment version. All authorized staff can assign or reassign, including staff who are not members of that project; admins retain the same access. Conflicting changes require reload; retrying the same assignment is safe. Retrying upload finalization returns the current asset and cannot overwrite a newer assignment.

Project Assets combines directly attached materials and assigned asset references, deduplicated within each context. Deliverable assignments appear under their deliverable in Project Assets, in the expanded auction reminder, in ordinary project work rows, and in standalone/task detail views. These are references to the original upload. Assignment does not edit production approval, final-file classifications, project budgets or publishing packages.

Project links open `?tab=assets`. Deliverable links open `?tab=deliverables&deliverable=<id>#deliverable-<id>` on the parent project; auction reminders expand and ordinary work rows focus the linked item. Standalone work opens its existing detail page. The existing Overview, Deliverables, Assets, Budget and Notes tabs all retain their functionality.

Successful mutations update the local record and broadcast the existing workspace change event. Other open views reload through the existing BroadcastChannel, focus/visibility refresh and 30-second polling. No upload-history entry is added by assignment changes.

## Validation and rollout

- Database tests run the complete migration chain in isolated PGlite PostgreSQL, including signed staff access, ordinary non-member reassignment, admin clearing, cross-organization and anonymous denial, stale writes, duplicate retries, forged upload metadata, finalization preservation and repeatable migration application.
- Client tests cover supported formats, MIME fallbacks, size limits, stable collection membership, newest-first history, filters, search and deep links.
- Browser verification uses the actual UI with a local API/Storage adapter backed by those real database functions. Verified document upload with title/note, a seven-file batch, decoded image previews, project-plus-deliverable assignment, project-only reassignment by different staff, audit names/times, clearing, cross-tab synchronization, focused reminder navigation, project Assets visibility, and 1440 px desktop and 390/320 px mobile layouts, both themes, horizontal scrolling without page overflow. Fixture records and upload bytes stay outside the repository and live services.
- All 157 tests, release build and typecheck pass. Lint has zero errors and the three existing authentication-navigation warnings.

Migration `20260924032636_jons_content_assignments.sql` is additive/reapplicable and has **not** been applied to the hosted database by this change. Apply it before releasing the matching UI/API. Existing earlier migrations should not be replayed. Use the repository's existing protected-preview and Steve approval process for hosted Auth/Storage checks and production release. Local verification does not substitute for hosted Supabase Storage/RLS acceptance or hosted database advisors.

## Final QA follow-up

See [Navigation and Assets final QA](navigation-assets-final-qa.md) for the video upload, second-staff assignment, file identity, cross-tab synchronization, desktop/mobile routing checks and fixes. Hosted acceptance remains pending as described there.
