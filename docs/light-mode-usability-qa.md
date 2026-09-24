# Light-mode usability pass — September 24, 2026

Northside HQ now defaults to light mode for new visitors while honoring saved theme preferences. The presentation uses a warm neutral page, shaded navigation and sections, white working surfaces, compact status indicators, and small owner dots. Northside branding and blue primary actions remain. Existing workflows and data architecture are retained.

## Scope

- Keep category → tab → work navigation and existing bookmarkable URLs. Group less-used tabs under More; preserve active labels, keyboard access, Escape, outside-click dismissal, and direct links.
- Show one page title. Place project, request, upload, checklist, and research actions beside it. Keep record-specific titles on detail routes.
- Simplify project cards, work rows, owners, status treatments, and staff access rows. Large record targets retain independent controls and secondary links.
- Keep Store Open Checklist's canonical November 20, 2026, 3:00 PM CST opening, its work and department views, and a single completion summary.
- Keep numbered weekly auction campaigns, reminder status, upload assignments, budgets, spend, reconciliation, history, notifications, and calendar destinations.
- Keep Jon's Content upload/assignment workflow with compact latest uploads and history.
- Clarify agreement name input and disabled acceptance, remove a duplicate theme control. Authentication, versioned agreement enforcement, acceptance logic, storage authorization, migrations, and API handlers are unchanged.

## Automated validation

- `pnpm test`: 181 passed, 0 failed (178 passed before the change; three focused rename/navigation checks were added).
- `pnpm typecheck`: passed.
- `pnpm build`: passed, production webpack build.
- `pnpm lint`: no errors; three existing `no-location-assign-relative-destination` warnings in agreement-actions, login-form, and sign-out. These full-page authentication transitions were left intact.
- `git diff --check`: passed.

## Browser review

Reviewed an isolated copy using the repository's test database migrations and synthetic fixture records. The preview-only auth adapter, fixture server, sample data, and agreement document placeholder are outside the repository and are not shipped.

Desktop review covered Home, Projects, Store Open Checklist, current auction, reminders, budget/reconciliation, Calendar, My Assignments, Requests, Assets, Jon's Content, Operations, project overview/work/notes/assets/history, work detail, request detail, research, editorial queue, results, date planning, calendar entries, permissions, login, password recovery, and the agreement layout.

All 12 primary working views were also checked at 390 px and 320 px. No page-level horizontal overflow, duplicate h1, or runtime error overlay appeared in those route checks. Horizontal navigation intentionally scrolls and reveals its active link. The agreement form was checked at 320 px. Dark mode was checked for readable surfaces and preference persistence after navigation.

Interactive checks passed:

1. Rejected an empty video, then uploaded a valid 6,603-byte video through Jon's Content. One upload transfer was recorded; stored SHA-256 matched the original bytes.
2. Assigned the upload to the #245 24 Hour Reminder. Its saved link opened the exact reminder, expanded it, and moved focus to the work item.
3. Changed that reminder to In Progress and confirmed the saved record.
4. Completed a checklist item. Progress changed to 2 of 5 / 40%; the item remained in Completed after navigation.
5. Opened More with the keyboard, closed with Escape and restored summary focus; selecting Results preserved the query URL and selected label.
6. Marked a notification read; unread count changed from 35 to 34 and the action changed to Mark unread.
7. Opened the relocated research dialog and asset upload form at 320 px.
8. Confirmed administrator staff/permission controls and the existing non-administrator view.

## Verification boundary

These are local browser and regression-test results, not a production acceptance claim. Hosted login/email, private storage delivery, live agreement PDF access/signing, real device browsers, and deployed infrastructure were not exercised. The separately requested #245 copy correction was applied to the live database as described below. Staff permissions, signatures, database schema, and external publishing destinations were not changed.

## Requested follow-up: #245 and Release Calendar

- Renamed #245 to **Collect Weekly Auction #245**, including its three reminder titles, current instructions/shared brief, archived project title/brief, and cached notification labels. Immutable historical snapshots stay intact; visible historical labels use the current campaign name.
- Applied the reviewed, tested data-only migration `20260924155834_collect_weekly_auction_245_name.sql` to the existing Northside Supabase project. No schema, permission, storage, or RPC changes.
- Verified five affected records, zero remaining old-name mentions in current copy, zero remaining notification mentions, and unchanged operational-data checksum `9cecda77ba9ca976920ea8f94817fc4e`. All 29 unrelated records and timestamps retain checksum `9a7b49a713d766f089ea6ae8824a63dc`.
- Removed the Release Calendar tab, dedicated view, and shortcut. Historical `?tab=releases` and release-calendar hash navigation resolve to Calendar. Imported Topps releases are omitted from the calendar/planning/export presentation; their saved records remain. Staff-created release work and research verification remain available.
- Added coverage for rename replay, preserved workflows and archival snapshots, retained independent staff edits after replay, current labels, unrelated campaign labels, old links, and hidden imported releases.
