# Four primary tabs — September 24, 2026

## Result

Primary navigation is exactly **Home | Calendar | Projects | Assets**. All four links remain visible at 320 px. Settings is a small labeled header link, with Staff access and administrator Permissions views. Settings has its own selected state and does not select a primary category.

Home defaults to the complete My Assignments view: priority/due-date groups, active work, recently completed work, and personal projects. The existing team schedule, active projects, and activity views remain available. Requests is linked beside the Home title, including while assignment data is loading or unavailable. Requests and request details select Home in primary navigation.

Old Assignments, Operations, Staff, Permissions, and setup links retain their selected view, other query values, and record fragments. Requests URLs remain intact. Known root hash bookmarks now reach their corresponding area; the password recovery path is unchanged.

## Validation

- 186 tests passed, zero failures. Five focused checks cover navigation context, query/fragment preservation, independent Home assignment filters, root bookmarks, and database authorization.
- Typecheck and production build passed.
- Lint: zero errors, three unchanged warnings for existing full-page authentication navigation.
- `git diff --check` passed.
- Reviewed 35 route/viewport combinations, including all four primary areas, Requests, Staff access, and Completed at 1440, 390, and 320 px. Also checked administrator Permissions, request detail, existing Home views, and legacy links.
- Route checks found exactly four visible primary links, one h1, one theme control, no page-level horizontal overflow, and no runtime error overlay. Existing secondary navigation remains horizontally scrollable where needed.
- Ordinary staff can read the Staff directory and do not see administrator controls. Direct database attempts to change access or permissions are rejected. Administrator access/permission updates pass; disabling staff still blocks access.
- Completed a task from Home, verified its saved `done` state, and found it in Completed after reload. Switching assignment views keeps Home selected.
- Opened the #245 24 Hour Reminder from Home; the exact project reminder expanded and received focus.
- Followed Requests and Settings controls and checked their headings/selected navigation. Activated a notification link with the keyboard and verified the unchanged deliverable destination.
- Browser error output was empty after the final checks.

## Scope and boundary

Browser checks used an isolated preview and synthetic records backed by the existing database functions. Preview auth/API adapters are outside the repository and are not shipped. Hosted authentication, storage, agreement signing, and real-device browsers were not revalidated in this pass.

No database migration, permission change, production record edit, or publishing change is required. Store Open Checklist, Collect Weekly Auctions, Jon’s Content, budgets, reconciliation, requests, research, agreements, notifications, uploads, and existing record destinations remain intact. Release Calendar stays removed, and #245 keeps its current name.
