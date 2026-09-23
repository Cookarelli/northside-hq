# Final HQ workflow and usability audit — September 23, 2026

## Readiness

The core project/deliverable workflows passed browser and database testing and are ready for real project data **after this PR is merged and deployed**, using the existing in-app notifications.

**Background email reminders are not implemented in this repository.** If automatic email reminders are a launch requirement, that remains a blocker. No email delivery or email rescheduling is claimed as tested. Existing in-app reminders are checked while HQ is open.

The browser audit used the actual application components with an isolated local PostgreSQL-compatible database running the repository's SQL functions and policies. Test identities represented Steve/management and Jon/ordinary staff. The fixture replaces the production sign-in/NDA entry point only in its separate local copy; production authentication, NDA gating, data and permissions were untouched. No test records or messages were sent to production.

## Workflows tested

| Workflow | Browser result |
| --- | --- |
| 1. Create project | Passed. From Home → Projects → Add project, created an active event project with title, description, Consignment owner, Jon/Zach staff and an event date. It immediately appeared as a project card and opened its detail page. Its event appeared on the matching calendar day. The assigned staff view included the project. |
| 2. Assign people | Passed. Searched for Steve, added him, removed Zach, searched a nonexistent name and received clear feedback. Selecting Jon again left exactly one Jon chip. Saved project people became Jon/Steve; owner remained Consignment. Verified purple computed border on cards and project header. |
| 3. Create deliverable | Passed. Created “Audit creative handoff” with date/time, Steve/Jon, High priority and notes. It appeared inside the project, exactly once on the calendar, and in Jon's assignments. Changed its status to In Progress inline. New deliverables retain the existing Not Started default. |
| 4. Complete work | Passed. From mobile My Assignments, completed the deliverable in one click. It left active groups and appeared in Completed recently. Calendar showed Complete; project progress became 1 of 2. Notification history marked the old deadline “No longer due for action.” |
| 5. Reschedule | Passed for the existing in-app workflow. Edited the deliverable from its project from September 23 at 3:00 PM to September 24 at 10:30 AM. Project detail, staff assignments and calendar reflected the new time; calendar contained one entry. Database regression verifies old reminders resolve and the new deadline has one active reminder. Email scheduling is unavailable. |
| 6. Overdue item | Passed. The seeded overdue graphic appeared in the staff Home group, My Assignments, project deliverable list, management team deadlines and project card with explicit Overdue text. |
| 7. Calendar to project | Passed. Calendar link opened the deliverable with title, parent project, owner, assigned staff, due date and status. The project link returned directly to the full project. |
| 8. Staff view | Passed under the ordinary staff database role. Jon saw Overdue/Today/Upcoming/recent completion groups and two assigned projects. Management editing controls were absent. Jon could complete assigned work and create a self-assigned deliverable within his project. |
| 9. Management view | Passed under the management database role. Active cards, owners, staff, progress, team deadlines, overdue labels and recent activity were visible. Steve could edit schedules and add Zach to a deliverable without changing Consignment ownership. |
| 10. Mobile | Passed at 390px. Checked assignments, opened a project, completed work, created a dated urgent self-assigned deliverable, and used Month/Week/Day/Today plus the selected-day agenda. |

## Friction found and fixed during the final audit

1. **Completed work briefly disappeared from both active and recent groups.** The UI clock is rounded to the minute while the database completion timestamp includes seconds. The recent-completion filter now includes the current clock minute. Added a regression test and confirmed immediate recent-history placement in the browser.
2. **A style rule masked project owner accents.** A border shorthand with `!important` overrode the inline owner color. It now sets only border width/style. Confirmed Consignment purple remains visible on the project header and cards.
3. **Missing event dates produced generic server feedback.** Active event/release/auction forms now use native required-date validation matching the existing server requirements. A blank event date receives focus before submission. Draft behavior is preserved.
4. **Project creation left focus outside the form.** New forms now focus Project title and restore focus to Add project on cancel. Verified at mobile width.
5. **Notifications called a deliverable assignment ownership.** Deliverable notifications display “Assigned to you” instead of “Assigned as owner”; project ownership messages are preserved. Stored notification records and delivery logic are unchanged.
6. **Campaign tools competed with the staff project list.** Launch plan, Tracked links and Results are grouped under Campaign tools. Verified those existing tools remain accessible and returning to Overview preserves visible keyboard focus.

These changes are small corrections to the completed design pass, not a redesign or a new data model.

## Responsive and accessibility evidence

- Home/calendar and project detail with the deliverable form were checked at **390, 768, 1280 and 1440 pixels**. Document width matched viewport width in all eight checks; no horizontal page overflow.
- Mobile assignment and project-creation forms also measured 390px without overflow. Week and Day calendars remained within the viewport.
- Desktop/laptop project cards had equal measured heights and consistent owner borders. Light and dark appearances were visually inspected; the original dark preference and default viewport were restored afterward.
- Tested staff picker labels, selection/removal feedback, native required-date focus, form entry/cancel focus, visible keyboard outlines and the skip link reaching `hq-main`. All visible fields in the project/deliverable form had accessible labels in the DOM check.
- Owner contrast regression tests, including CEO yellow, pass. Owner names remain present alongside colors.
- Final browser console error check was empty. An earlier reload had an extension-injected hydration warning referring to `scrnli_recorder_root`; it did not recur on the final pass and no application workaround or extension setting change was introduced.

## Final checks

- Lint: passes, with four unchanged pre-existing warnings in Hub, login, agreement actions and sign-out.
- Typecheck: passes.
- Tests: **92 passing**.
- Production build: passes.

## Remaining limitations and unchanged behavior

- Email reminders/background scheduling remain absent. The app explicitly describes its while-open in-app reminder behavior.
- General projects do not have dedicated start/target-completion fields. Existing event/release/auction dates and deliverable deadlines remain supported; no speculative fields were added.
- New deliverables start Not Started; status can be changed immediately from the project list after creation.
- This was an isolated browser/database acceptance run, not a new production authentication or email-provider delivery test. Production auth and NDA code were unchanged; existing security regression tests remain passing.
- No schema changes, migrations, dependencies, production data edits/deletions, or publishing-workflow changes. **No migration commands are needed.**

Changes are on `codex/hq-usability-polish`, PR #8. The branch has not been merged or deployed to production by this audit.
