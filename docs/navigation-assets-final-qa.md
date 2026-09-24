# Navigation and Assets final QA

Date: September 24, 2026 (UTC). Scope: usability, routing, authorization preservation and asset identity. The existing interface and workflows were retained.

## Fixes from this pass

- Keep the active category/tab visible when the viewport changes from desktop to mobile. The navigation resize observer disconnects on unmount.
- Return keyboard focus to the project/deliverable selector after choosing an option or pressing Escape; Escape closes the selector while keeping the assignment dialog open.
- Give linked auction reminders keyboard focus as well as expanding and scrolling to them, matching normal deliverables.
- Constrain tab panel grid sizing so the Results table scrolls inside its panel instead of widening the mobile page.
- Move Home's duplicated team-deadline list into Schedule. My work now shows personal assignments once; the team list and all its links remain available in Schedule.
- Show existing auction numbers in Project Assets, shared work lists and date-planning labels without rewriting stored titles.

## Video upload and assignment evidence

The actual browser UI uploaded a synthetic two-second H.264 MP4 as Jon after an older text upload. The video decoded at 320 × 180 and appeared immediately as the first item in both Latest Uploads and Upload History, initially Unassigned. Title, short note, upload date and uploader were retained.

An ordinary staff fixture identity with no project membership selected Collect Weekly Auctions and **#245 Michael Jordan — 24 Hour Reminder** using the searchable selectors and saved. The video appeared in Project Assets and in the expanded reminder. The assignment recorded the second staff identity and database timestamp while preserving Jon as uploader.

Before/after snapshots verified:

| Evidence | Before assignment | After assignment and further reassignment |
| --- | --- | --- |
| Upload transfers | 2 | 2 |
| File byte entries | 2 | 2 |
| Asset records | 2 | 2 |
| Video ID | `f8aa9dec-4172-4a57-beff-a722cb11449a` | Same |
| Video size | 6,603 bytes | Same |
| Storage-object metadata and names | Captured | Unchanged |
| SHA-256 | `96aee8cb7e386c80e4dc5ea24d8babf031322ba9dfe3754888180b9541d777a7` | Same |

Project-only assignment also passed. Moving the video to the 48 Hour Reminder removed it from an already-open 24 Hour Reminder view without reloading; the new context used the identical asset URL. Moving it back restored it in the open original view. Latest Uploads, upload history and file counts did not multiply. Database tests additionally cover clearing, stale updates, retry safety, finalization retries, forged attribution, deleted destinations, cross-organization denial, unsigned/anonymous denial and admin access.

## Browser and routing results

- Jon's Content: prominent upload, decoded thumbnail and video controls, newest-first ordering, All/Unassigned/Assigned filters, compact horizontally scrolling latest strip, searchable optional assignment and project filtering.
- Project links open Assets; reminder links open Deliverables, expand the exact reminder and place keyboard focus there. Budget links select the right auction and scroll directly to the clicked reminder's spending section.
- Calendar deliverable links open the correct project/Deliverables tab. A completed ordinary task expands its Completed group and receives focus.
- Weekly auctions: Current Auction #245, upcoming #246, Deliverables, Assets, Budget & Reconciliation and historical #244 are reachable. Selected history survives refresh and browser back/forward. Current Auction clears an old auction selection.
- Normal projects: Overview, Deliverables, Assets, Budget and Notes / Activity render their respective existing functionality without stacked duplicate areas. An individual assignee updated status, then a project member completed that same deliverable.
- Release Calendar supports direct `?tab=releases` access and refresh; its verification link opens Research → Release verification. Calendar planning filters and existing entry/series editors remain available.
- Home, Projects, My Assignments, Requests, Assets, Operations and Calendar have visible active category/subpage state. Existing Projects tools, Request areas, request details, staff access and admin-only Permissions remain accessible. The old project Permissions URL redirects to Operations.
- Desktop 1,440 px and mobile 390/320 px checks passed without page-wide overflow on checked screens. Tabs and Latest Uploads remain horizontally scrollable. Results now keeps its table overflow inside the panel.
- No active Video Cutting links, cutting/editing queues, status controls, public renderer or obsolete cutting buttons exist in application source. Historical cutting hash destinations resolve to Assets; archived historical records remain read-only. The agreement/NDA route and access gate are unchanged; no agreement was signed during QA.
- The final browser error-log check returned no errors.

## Automated validation

162 tests pass. Type checking and the release build pass. Lint has zero errors and the same three existing authentication-navigation warnings. The added data-integrity regression compares all asset IDs and storage objects before and after video assignment/retries; another assertion covers numbered date-planning labels without mutating source titles.

## Verification boundary and release gate

These browser checks used the real application components with an isolated API/Storage adapter and PGlite executing the repository's checked PostgreSQL functions and migrations. Staff identities and file transport were fixture implementations, not real hosted Supabase sign-ins or signed Storage URLs. External release feeds contained no fixture releases; direct navigation and empty-state behavior were checked, not a live feed refresh. The adapter is outside the repository and is never deployed.

Hosted Supabase Auth/Storage/RLS acceptance with Jon and a second real staff account remains pending. Migration `20260924032636_jons_content_assignments.sql` must be applied to the intended hosted test database before releasing the matching UI/API. No hosted records, files or staff permissions were changed by this QA pass. Production merge/deploy remains subject to the existing Steve approval process.
