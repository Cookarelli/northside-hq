# Northside HQ: getting started and testing

Use this checklist for the first staff pilot. Start with two or three real projects and finish one complete handoff before adding the whole backlog.

## Set up the team

1. Use the existing [Northside HQ testing site](https://marketinghub-7vl1-git-codex-nor-9ffb74-steves-projects-e37a4ef4.vercel.app/). It uses the separate testing database. Keep its bookmark distinct from the production site.
2. Give each person an individual, verified account and an active staff roster entry. Steve's account is active with administrator, budget-approval and request-coordination access. Provision other staff through the existing account/roster process before assigning them work.
3. In **Operations → Permissions**, an administrator selects budget approvers and request coordinators. Confirm Joey's account and capabilities before depending on him for approvals. Give these permissions only to the people who need them.
4. Agree on who owns each project, who creates the deliverables and who publishes. The project owner approves creative work; budget approval is a separate permission. Standalone deliverables need a named approver.
5. Use the header **Light mode / Dark mode** switch for your preferred appearance. It remembers your choice in that browser. Clicking the Northside logo returns to Today.

## Add the first projects

1. Choose Weekly Auction, Event, Product Release or General. Use a consistent title such as “Weekly auction — September 27” or “October trade night.”
2. Write a short brief: purpose, audience, required output and the information the creator needs. Set the owner, members and relevant event or auction dates.
3. Keep a project Draft while its essentials are missing. Review the missing-information list, then make it Active when the team should begin.
4. Create specific deliverables, such as “Instagram announcement,” “Facebook reminder,” or “Print event signage.” Each needs one accountable owner, clear instructions and a committed production deadline. Add contributors only where useful.
5. Keep the requested deadline, production deadline and intended publication time distinct. Allow time for review and corrections before publishing. All displayed dates use America/Chicago.
6. Attach references and label files **Reference**, **Draft** or **Final**. After uploading, save the record. Open a saved attachment once to confirm that the right file was attached.
7. For publishing work, set the format, destinations, publisher and planned time. Facebook and Instagram each retain their own status, even when they share a deliverable. Use separate deliverables when their creative content or captions need separate review.
8. Add a budget only when money is involved. An authorized approver establishes the approved amount; the project owner allocates within it. Enter actual advertising and creative costs separately. These entries never purchase ads.

## Run one complete acceptance test

Use a clearly labeled QA project in the testing workspace and at least two individual accounts. Do not upload sensitive material or record a real-world publication that has not happened. Check off each result only after refreshing the page.

| Check | Expected result |
| --- | --- |
| A staff member submits a request with a requested deadline and reference | Request shows the requester, New status, requested date and accessible attachment. |
| A coordinator accepts it into a project, then revisits/retries | One project is created; the accepted request retains its link. No duplicate work appears. |
| Assign a creator, approver and publisher; set a committed deadline | The assignments persist. The committed deadline does not overwrite the request's original date. |
| Creator uploads a Draft, saves and submits for review | The project owner sees the review request and can preview/download the saved file. |
| Owner requests changes with a comment | Work returns to In progress; the creator sees the reason and notification. |
| Creator saves the Final file and resubmits; owner approves | Ready work contains the approved version, reviewer and time. |
| Replace the approved file or change the caption/link | Approval is cleared and another review is required before handoff. |
| Budget approver sets an amount; owner allocates it | Allocation within approval succeeds; excess allocation and unauthorized approval fail. |
| Publisher opens the approved package on a phone | Final download, caption copying and destination link work. Required fields fit the screen. |
| Record scheduling/publication only after it actually happens on the platform | A confirmed Facebook destination does not change Instagram. Published includes actual time and live URL, or the supported explanation when unavailable. Leave this check pending until there is a legitimate publication to record. |
| Change a production/publication date and refresh Today, Projects and Calendar | All views agree because they use the same saved work. Dates remain in Central time. |
| Reopen Notifications and use Check reminders repeatedly | Existing notices retain their read state and do not multiply without a new event or deadline phase. |

For a safe budget check, use an explicit QA amount in the testing project. Actual-spend entries describe incurred costs; do not record invented spending on real projects.

## Check access and everyday usability

- Confirm ordinary staff cannot grant themselves budget/coordinator permissions or approve someone else's project. A signed-out browser must not open project records or private attachments. The public header logo is deliberately accessible; this does not grant access to uploads.
- With test accounts, verify an unrelated organization and an inactive roster member cannot access internal work. Do not change real staff permissions just to simulate failure.
- Check existing calendar entries, recurring series and saved assets remain available. Use the existing editors rather than copying them into duplicate records.
- Check a blocked deliverable names the person who can resolve it and appears in that person's Today view.
- On an actual phone, test upload, preview, download and caption copying. Check both themes, refresh, the category and subpage navigation, sign-in/recovery and a failed-upload retry. Desktop mobile emulation is not a substitute for this device check.
- Test Chicago date edits around daylight saving with a QA record. The app asks for a different time when a local time does not exist in spring or occurs twice in fall. Avoid those ambiguous times for actual work.
- Confirm a failed save has a clear error and preserves your input. Refresh after saving to distinguish persisted work from unsaved form text.

## Daily habits and rollout

- Begin in **Today → My Work**. A coordinator checks **Team** for overdue, blocked, unassigned and unfinished publishing work. Reviewers clear their approval queue.
- Put feedback in the record's comments and mention the relevant person. Keep important decisions and reference links beside the work.
- Scheduling and publication stay manual. Calendar dates are plans, not proof that a platform action happened.
- Deadline reminders are checked while HQ is open. They do not run automatically while everyone has it closed. Keep existing deadline habits during the pilot.
- Record issues with the page/project link, what you expected, what happened, staff role, device and a screenshot if helpful. Do not include passwords or private keys.
- Before expanding use, finish the hosted workflow/access checks, verify hosted file recovery/backups, and agree on the authoritative workspace. Projects entered in this testing database do not automatically move into production. Preserve/export pilot records and plan any migration before making a switch.

The implementation and earlier local verification are documented in [Northside HQ](northside-hq.md). Production rollout still follows the existing pull-request review and Steve's approval.
