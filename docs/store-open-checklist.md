# Store Open Checklist

Projects → Store Open Checklist is the existing launch-planning area renamed in place. Its canonical link is `/projects?tab=store-open-checklist`; `/projects?tab=launch`, `/projects#launch` and `/#launch` remain compatible. There is one category tab and one saved plan identity: `marketing_records`, kind `plan`, ID `launch`.

The primary deadline is **Store Opens — Friday, November 20, 2026 — 3:00 PM CST**. The source values are `2026-11-20`, `15:00`, and the IANA zone `America/Chicago`. Display labels and the machine-readable instant derive through the existing Chicago timezone conversion. The fixed official milestone replaces the old editable date field and the outdated tentative-opening text.

This temporary cross-department hub links directly to the existing Projects, Deliverables, Calendar and Assets tools. The original strategy, budget scenarios, campaign settings, store address and forecasts remain available. Project ownership, work assignments, department coordination, notes, activity, supporting files and completion controls continue to live with the same project/deliverable records; no second work system is created.

## Preservation

Migration `20260924054422_store_open_checklist.sql` updates the existing Northside `plan/launch` row, if present. It retains its ID, timestamp, budget, campaign, address, other fields and related records. Previous opening/title fields are retained under `legacyLaunchPlanOpening`. Historical plan IDs and other workspaces remain untouched. No project, deliverable, file, assignment, calendar post, permission or history record is inserted, deleted or moved.

An invoker trigger uses the existing authorization boundary and preserves omitted plan metadata on older-client saves. It keeps the official date, time and timezone consistent. API validation retains extension fields instead of stripping historical metadata. Migration replay is safe and does not create plan records. With no saved plan, the existing default form displays the official milestone and still saves to `plan/launch`.

## Verification

Regression tests cover Chicago date/time conversion, legacy bookmarks, in-place migration with old saved fields, migration replay, old-client saves, cross-workspace/history preservation and existing authentication/agreement checks. Run the repository tests, typecheck, lint and production build before release. Browser checks should cover the renamed tab on desktop/mobile, old URL canonicalization, refresh/back/forward and editing/reloading preserved campaign settings.

Completed checks: 165 tests pass; typecheck and production build pass; lint reports zero errors and three existing authentication-navigation warnings. Desktop and 390 px mobile browser checks passed for the visible milestone, active tab, legacy query/hash links, refresh/back/forward, saved campaign and budget preservation, address editing and reload. The isolated database retained one original plan record plus its notes, assets and earlier opening date; the browser error log was empty. Auth and transport in this browser fixture were isolated; production credentials and records were not used.
