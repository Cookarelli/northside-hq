# Store Open Checklist work hub

Projects → Store Open Checklist (`/projects?tab=store-open-checklist`) opens active store-opening work. The official deadline remains November 20, 2026 at 3:00 PM **America/Chicago**, displayed as Friday, November 20, 2026 / 3:00 PM CST.

## Working in the hub

- **Add Project** creates a normal `project` record with the checklist link, free-text department/category, roster owner, additional members, deadline, priority, description and existing project status.
- **Add Deliverable** creates a normal task deliverable under a checklist project or directly in the checklist. It supports owner, additional assignees, deadline, priority, existing task status, notes and supporting assets/links.
- Supporting files use the existing private asset upload and attachment system. Attaching a saved asset does not copy or upload it again.
- **Active**, **By Department**, and **Completed** are URL-backed view filters. The department view can group by responsible owner instead. Blank departments fall back to the owner's name; children inherit the project's department unless they have their own.
- Search covers title, department, owner and parent project. Lists show up to 12 records per page. Unscheduled and after-opening work stay visible with a warning rather than silently disappearing.
- Completion counts each nonarchived project and each nondeleted deliverable once. Completing a project does not silently complete its deliverables. Unfinished work in a closed project prompts the user to reopen the project.

The existing opening plan is retained at `?tab=store-open-checklist&view=plan`. Its original `plan/launch` identity, metadata and saved strategy/budget values are preserved.

## Calendar and deadlines

- The existing HQ calendar derives one **Northside Store Opens** milestone from the shared opening constant. It displays November 20, 2026 at 3:00 PM CST, uses `America/Chicago` internally, and opens the checklist. It creates no calendar or project record.
- Checklist project deadlines and deliverable due dates appear automatically from their canonical records. Rescheduling updates the same calendar item. Project links open the project overview; child deliverables open the project's Deliverables tab and focus the specific item; direct deliverables open their work page. Each destination includes a Projects → Store Open Checklist breadcrumb.
- The hub's quiet countdown shows days, adding hours during the final week, and never displays seconds. It uses the existing minute clock and is replaced by “Store Opened” once the milestone passes.
- Checklist work uses **Upcoming**, **Due Soon**, **Overdue**, and **Complete**, retaining the existing 48-hour due-soon rule and completion status. Creation and edit forms warn **Due after store opening** for dates later than the opening instant without blocking saving. Unscheduled work stays visible with “No deadline.”

## Safe sunset and launch archive

At November 20, 2026 at 3:00 PM America/Chicago, the same checklist becomes a launch archive. The header reads **Store opened November 20, 2026 at 3:00 PM CST**, the countdown becomes **Store Opened**, and the active progress panel becomes a simple summary of total/completed projects, total/completed deliverables, and remaining items. Counts continue updating as staff finish work; there is no frozen copy or duplicate record.

The primary Store Open Checklist tab moves under **Projects → Archived / Completed → Store Open Checklist**. That area reuses the existing completed/archived project statuses and cards. The canonical `/projects?tab=store-open-checklist` URL stays valid, including its view filters, strategy/budget subpage, old `launch` bookmarks, project/deliverable breadcrumbs, and historical calendar links. The archive route exists before the active checklist tab is hidden.

The archive opens to **Remaining**, retaining **By Department** and **Completed**. It also includes manually archived checklist projects in its project totals and work list. An archived project is not assumed to be complete. Previously soft-deleted deliverables remain preserved by the existing history/restore system and are excluded from work counts, as before.

Sunset runs only as a read-only presentation calculation using the shared minute clock (also refreshed on focus). It never updates project/deliverable status, owners, assignments, dates, assets, notes, comments, activity, or calendar records. No migration, scheduled job, cleanup, deletion, or new storage is required. New-work buttons are no longer promoted in the archive; an editor already open across the transition retains its unsaved fields. Existing edit and completion actions remain available under the same permissions. Projects explicitly closed by staff still follow their existing reopen-before-editing rule; sunset does not close them.

## Data and permissions

There are no new tables, record kinds, storage buckets, department enums or status systems. Optional `storeOpenChecklist`, `department`, and `priority` fields extend existing records. A project's existing `eventAt` carries its due date; deliverables retain `productionDue`. Normal editors preserve checklist metadata; direct tasks can be edited through their existing deliverable page. Calendar, project Assets, notes/activity and assignments read the same records.

Active, verified staff with the required agreement can create checklist work and assign colleagues. This creation permission is limited to checklist work. Existing project owner/admin and task manager rules govern editing saved details. Project members and individual deliverable assignees retain status permissions; unrelated staff do not gain status/edit permission. Version checks, organization checks, agreement gates, normal publishing workflow and activity history remain in place.

Apply `20260924061808_store_open_work_hub.sql` before publishing the application change. It updates existing checked functions and adds a private input validator. It does not rewrite or copy historical records. Replaying it is data-preserving. For rollback, revert the application; leave the optional metadata and compatible database extension in place to preserve newly created work.

## Verification

- 181 automated tests pass, including checklist creation, standalone/child tasks, manager and assignee authorization, cross-organization rejection, invalid dates, concurrency/version protection, calendar links, counters, grouping, deleted history and migration replay. Calendar/sunset tests cover the single milestone, date ranges, source rescheduling/deletion/completion, Chicago's fall time change, exact deadline boundaries, countdown formatting, archive navigation and summary counts, retained history, and completion permissions after the presentation changes.
- Type checking and production build pass. Lint has no errors; three existing authentication-navigation warnings remain.
- Isolated browser/database verification: create a project, create a child deliverable, create a direct deliverable, upload and reuse one supporting document, update status as a project member, check progress and completed view, group by department/owner, search, refresh/back/forward, edit the direct item through the normal deliverable editor, and view its shared asset in both deliverable and project Assets tabs.
- Desktop and 390px mobile UI checked; no browser console errors observed. Existing plan fixture values remain accessible in the strategy view.
- Calendar browser checks confirm the opening milestone and project/deliverable deadlines in the mobile date agenda, the focused deliverable deep link, the checklist breadcrumb, and the milestone link back to the hub. An after-opening direct deliverable saved successfully with the warning visible; the isolated database contains one new deliverable and no duplicate calendar record.
- Sunset browser checks use an isolated clock immediately before and at the official opening instant. The transition preserves all 24 fixture records, its comment and all 29 activity entries byte-for-byte, including an unsaved edit. A project member then completes a remaining task and the summary updates. Verified the archived/completed listing, manually archived work, notes, comments, completion dates, calendar milestone link, original strategy values, mobile layout without horizontal page overflow, refresh/back/forward, and legacy URL normalization. No production data was used or modified.
- Browser fixtures were isolated from production. Hosted deployment and production migration require the repository's production approval.
