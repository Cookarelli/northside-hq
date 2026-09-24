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

## Data and permissions

There are no new tables, record kinds, storage buckets, department enums or status systems. Optional `storeOpenChecklist`, `department`, and `priority` fields extend existing records. A project's existing `eventAt` carries its due date; deliverables retain `productionDue`. Normal editors preserve checklist metadata; direct tasks can be edited through their existing deliverable page. Calendar, project Assets, notes/activity and assignments read the same records.

Active, verified staff with the required agreement can create checklist work and assign colleagues. This creation permission is limited to checklist work. Existing project owner/admin and task manager rules govern editing saved details. Project members and individual deliverable assignees retain status permissions; unrelated staff do not gain status/edit permission. Version checks, organization checks, agreement gates, normal publishing workflow and activity history remain in place.

Apply `20260924061808_store_open_work_hub.sql` before publishing the application change. It updates existing checked functions and adds a private input validator. It does not rewrite or copy historical records. Replaying it is data-preserving. For rollback, revert the application; leave the optional metadata and compatible database extension in place to preserve newly created work.

## Verification

- 173 automated tests pass, including checklist creation, standalone/child tasks, manager and assignee authorization, cross-organization rejection, invalid dates, concurrency/version protection, calendar links, counters, grouping, deleted history and migration replay.
- Type checking and production build pass. Lint has no errors; three existing authentication-navigation warnings remain.
- Isolated browser/database verification: create a project, create a child deliverable, create a direct deliverable, upload and reuse one supporting document, update status as a project member, check progress and completed view, group by department/owner, search, refresh/back/forward, edit the direct item through the normal deliverable editor, and view its shared asset in both deliverable and project Assets tabs.
- Desktop and 390px mobile UI checked; no browser console errors observed. Existing plan fixture values remain accessible in the strategy view.
- Browser fixtures were isolated from production. Hosted deployment and production migration require the repository's production approval.
