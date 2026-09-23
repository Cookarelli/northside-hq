# HQ usability and workflow audit — September 23, 2026

## Release decision

The code and database regression checks pass. This is a **draft release candidate**, not a completed interactive audit or a production deployment. Desktop, laptop, tablet, and mobile browser acceptance remains blocked by Chrome's open-extension interface and pending macOS computer-use permissions. No production test projects were created and no production records were changed or deleted.

Email reminders are also an existing capability gap: this repository checks in-app deadline reminders while HQ is open. It has no background email reminder sender/scheduler. The audit preserves this behavior; it does not claim to validate email delivery.

## Workflow evidence

| Requested workflow | Evidence and result | Remaining acceptance |
| --- | --- | --- |
| Create project | Database tests cover creation, owner validation, persistence, project types, dates and permissions. Dashboard empty-state action now opens the creation form. | Click through the form from Home and verify the resulting card. General projects do not have separate start/target-completion fields; existing event/release/auction dates remain supported. |
| Assign people | Existing roster and server assignment checks retained. Search, selected staff chips, removal, and checkbox selection are shared across forms. Existing tests reject duplicate deliverable staff and inactive staff. Owner colors remain independent of assigned staff. | Browser search/select/remove and keyboard interaction. |
| Create deliverable | Database tests cover canonical record creation, multiple staff, priority, notes, date validation and role checks. Calendar tests verify source-record projection without duplicate task entries. | Submit the UI form and check all three surfaces. New deliverables start Not Started; the project row exposes status changes after creation. |
| Complete work | Assigned-staff status changes and server-owned completion timestamps pass database tests. UI grouping tests move completed work out of active groups into recent history. New test proves in-app reminders stop after the reminder check. | Browser one-click completion, visible project progress and calendar status refresh. |
| Reschedule | Tests verify one canonical record, current-version enforcement, correct calendar date, and one active reminder at the new due time. Old reminder history resolves rather than disappearing. | Browser editing and cross-page refresh. Email scheduling cannot be tested because it is not implemented. |
| Overdue work | Chicago-time grouping and urgency tests pass. Visible text labels now appear on shared work rows, project cards, assignment groups and team deadlines. | Visual prominence at all viewports. |
| Calendar to project | Deep-link tests pass. Calendar items retain associated deliverable/project links. Detail pages retain owner, assigned staff, due date and status. | Browser navigation and back-to-project interaction. |
| Staff view | Database tests enforce assignment permissions; quick-completion helper tests reject unrelated staff, deleted work, closed projects and publishing workflows. New My Assignments route groups actionable work. | Signed-in staff experience and keyboard walkthrough. |
| Management view | Existing management rights preserved. Active cards, team deadlines, project people, inline deliverable controls and activity are available. | Management dashboard scan test. |
| Mobile | Responsive CSS now uses a compact month grid plus selected-day agenda, stacked work rows/forms, four primary navigation items and touch-sized controls. | 390px/768px/1280px/1440px browser testing, overflow checks and touch/keyboard actions are **not yet verified**. |

## Friction corrected

- Dashboard order is Calendar → My Assignments → Active Projects → Upcoming Deliverables → Recent Activity. Long dashboard lists have explicit links to full views.
- Home, Calendar, Projects and My Assignments form the primary navigation. Requests and Assets remain under More tools.
- Calendar items emphasize title, project, owner and time with subtle owner borders. Month cells limit detail and expose additional items through Day view. Smaller layouts expose a selected-day agenda.
- Calendar task statuses now display Waiting and Complete consistently instead of inheriting the generic production labels.
- Shared work rows show project, owner, assigned staff, due date, status and priority. Authorized staff can complete operational deliverables directly. Publishing approval/confirmation steps remain separate.
- My Assignments uses disjoint Overdue, Today, Upcoming and Completed recently groups; empty groups disappear. Confirmed server responses immediately update the assignment display.
- Project cards have consistent title/metadata ordering, restrained owner accents, title truncation, progress and textual urgency.
- Project deliverables appear before financial tools. Inline editing exposes schedule and staff, while status and completion controls stay in the list. Budgets, optional resources and comments use disclosure sections.
- Creation links open the project form directly; staff search has a useful no-results message. Assignment validation asks for a staff member plainly. Deliverable forms focus the title and restore focus on close.
- Shared spacing, surfaces, labels, button sizing and focus styles replace conflicting HQ rules. An old grid rule that overrode the new work rows was corrected.
- Closed projects are excluded from new-work targets, matching existing server restrictions.

## Changed components

Main pages: Home, Calendar, Projects, project detail, deliverable detail, My Assignments, and navigation shell.

New shared code: `HqWorkItem`, `HqProjectDeliverables`, `HqAssignmentsPage`, `/assignments`, and presentation helpers for assignment groups, urgency and activity labels. Existing staff picker and project card components are reused.

Tests: presentation/calendar/permission regression cases and a database reminder lifecycle test. The local browser fixture uses a separate temporary database and is not shipped.

## Checks

- Lint: passes with four pre-existing warnings in Hub, login, agreement actions and sign-out. No new warnings.
- Typecheck: passes.
- Tests: 91 passing.
- Production build: passes.
- Owner color contrast regression tests: pass, including CEO yellow.
- Interactive accessibility, responsive screenshots and browser console checks: blocked, not claimed as passed.

## Deliberately unchanged

Authentication, NDA gating, staff roles, database policies and migrations, existing records, publishing approvals, manual destination confirmations, recoverable deletion/history, canonical deliverable-calendar synchronization, and notification delivery rules are unchanged. No dependencies were added. No migration commands are needed for this pass.

Before a final go-live sign-off, unblock browser control and finish the interactive workflow/viewport checklist above. If email reminders are required for launch, implement and verify that capability as a separate scoped change.
