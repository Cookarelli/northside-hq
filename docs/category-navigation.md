# Category navigation and Assets

The top-level categories remain Home, Calendar, Projects, My Assignments, Requests, Assets and Operations. All are visible in a horizontal main navigation; mobile users can scroll it horizontally. Shared `HqSubnavigation` links use Next.js navigation and `?tab=`. Only the selected major area mounts. Native link keyboard support, visible focus, aria-current, open-in-new-tab, browser history and query preservation are retained.

| Category / subpage | Major areas | Default |
| --- | --- | --- |
| Home | My work, Schedule, Active projects, Recent activity | My work |
| Projects | Projects, Deliverables, Handoffs, Launch plan, Tracked links, Results | Projects |
| Normal project | Overview, Deliverables, Assets, Budget, Notes / Activity | Deliverables when work exists; otherwise Overview |
| Collect Weekly Auctions | Current Auction, Deliverables, Assets, Budget & Reconciliation, Auction History, Project information, Notes / Activity | Current Auction |
| Deliverable | Work, Assets, Budget, Publishing, Source review, Notes / Activity | Work |
| Calendar | Calendar, Release Calendar, Date planning, Entries & series | Calendar |
| My Assignments | Active work, Completed, My projects | Active work |
| Requests | General requests, Editorial queue, Top stories, Stories, Products | General requests |
| Request detail | Request & decision, Notes / Activity | Request & decision |
| Assets | All Assets, Jon’s Content | All Assets |
| Operations | Staff access, Permissions (administrators) | Staff access |
| Research subpage | Feed, Release verification, Chase Cards, Drafts, Sources | Feed |
| Migrated campaign | Original campaign, Notes / Activity | Original campaign |

Only the selected area renders. Files/links must exist before an individual project or deliverable shows Assets. Publishing and source-review tabs require their corresponding workflow/data. Deliverables is available when work exists or the user can create it; deleted work remains recoverable. Auction History appears when historical campaigns exist. Budget and Notes provide the existing budgeting/spending and discussion workflows rather than empty placeholder panels. Staff access and permissions move intact from Requests/Projects into Operations, with the same authorization; old URLs redirect to their new home.

Current Auction selects the next unreconciled auction by Chicago closing time, falling back to the latest unfinished past auction. Closed/reconciled campaigns outside that current selection appear in Auction History; future auctions remain accessible from Current Auction and the Deliverables filter. Auction numbers stay attached to campaign titles, selection links, reminders and calendar entries. Deliverables contains production actions; Budget & Reconciliation contains campaign totals, reminder budgets, channel spend, corrections and reconciliation. The previous overall project spending ledger remains available through the Project-wide budget and spending subpage within Budget (`scope=project`). Campaign records and reminder records are reused throughout.

Small controls (status, filters, calendar month/week/day, record editors) remain in context. A project member or individual deliverable assignee still uses the existing status controls and checked database commands. No permission or approval rules changed. Notes/activity is isolated from the work editor; full deliverable links reach its Work subpage without looping back to the project list.

The existing employee agreement/NDA flow is one gated document-review-and-sign action at `/agreements/required`, not an administration dashboard. It remains focused, with the private PDF, signature and access gate unchanged; no empty agreement tabs or new agreement-management system were introduced. Release verification is the existing verification workflow under Assets → Research & sources → Release verification; Release Calendar links there directly. Research has its own subpage navigation, never nested tab strips within the two Assets tabs.

## Direct destinations and compatibility

- All calendar deliverables, including ordinary tasks and completed work, open `/projects/[id]?tab=deliverables&deliverable=[id]#deliverable-[id]`. Completed groups expand and the selected work receives focus. Standalone deliverables retain `/projects/work/[id]`.
- Project event/date links open Overview. Jon’s assigned project links open Assets; its deliverable links open/focus Deliverables. Full deliverable files and assignments live under its Assets subpage.
- Spending and budget activity open Budget; project-wide ledger events include `scope=project`. Publishing events open Publishing. Comment/mention events open Notes / Activity.
- Numbered auction links preserve the selected auction between Deliverables, Budget and History. Returning to Current Auction clears an old auction selection.
- Release items open Release Calendar; its verification link opens the research Release verification tab. Legacy calendar entries and series retain their existing editor links.
- `/projects?tab=permissions`, `/requests?tab=staff`, `/requests?view=staff` and `/content-radar/setup` redirect to Operations. Other historical `view` and hash bookmarks remain supported.
- URLs retain browser back/forward and refresh behavior. Changing major areas clears transient creation, incompatible record focus and project-wide-budget scope.

## App-wide navigation verification

161 automated tests pass, including current/upcoming/history partitioning, meaningful tab availability, direct destinations, migration replay and project-member/individual-assignee status access. Type checking and release build pass. Lint has no errors and the same three pre-existing authentication-navigation warnings.

Isolated browser verification covers Current Auction (#245), upcoming #246, past #244, filtered reminders, persisted status and no-spend confirmation, bookmarked history after reload, ordinary task completion by a project member and then an individual assignee, completed-item calendar focus, request detail navigation, staff/admin Operations visibility, legacy Operations redirects, Release Calendar → verification, and document upload → assign → same asset in Project Assets and the focused deliverable. Desktop 1440 px and mobile 390/300 px layouts retain horizontal navigation without page overflow. An activity-view duplicate React key found during testing was fixed and a fresh browser run reports no console errors for that view.

Browser data and storage responses are isolated fixtures, backed by the real checked Postgres workflow functions in PGlite. Hosted Supabase Auth/Storage acceptance remains a release check. This navigation follow-up requires no additional database migration and makes no hosted data changes. The Jon’s Content assignment migration remains pending as documented in [Jon’s Content](jons-content.md).

## Retired workflow and preservation

The former Library & editing studio no longer renders or accepts editing jobs. Clip finding, cut review, job controls and editing recipe exports have been removed from the application. The Python renderer is preserved in `docs/archive/render_package.py`, outside public routes. Historical `clipjob` JSON remains in the database and workspace export, readable but not writable through the application or database RPC. No historical rows or media objects are deleted, renamed, or backfilled.

The migration replaces only the existing checked `private.save_record` function. It rejects clip-job writes and records the authenticated staff ID in new upload metadata, preserving the existing organization/NDA checks and RPC privileges. Upload metadata cannot be overwritten under the same ID. All other record handling stays the same; no new tables or columns. Reapplying the migration is safe.

Jon’s Content now uses a stable upload collection plus known historical Jon uploads. Its visible upload control, latest-upload strip, searchable history and project/deliverable assignment flow are documented in [Jon’s Content](jons-content.md). Assignment links reference the same private asset, and changes synchronize across Project Assets and deliverable contexts. Files do not enter or leave this upload history merely because Jon is assigned to the surrounding work. Legacy files with unknown uploader remain in All Assets.

## Initial navigation verification

- 151 automated tests pass, including migration replay, read-only job history, forged uploader prevention, private upload finalization/retry and organization boundaries, plus all existing weekly-auction permission/budget/reconciliation checks.
- Production build and type checks pass. Lint has no errors and three unchanged auth-navigation advisories.
- Isolated browser checks cover category links, selected-only content, refresh, back/forward, old bookmark compatibility, project status persistence and calendar-to-expanded-reminder links. Multi-file uploads through the form produce one asset per file with private media previews and remain in Jon’s Content after refresh. Desktop 1440px and mobile 390px/320px layouts have no page overflow; the selected navigation link remains visible in the horizontal strip. Both color themes were checked. Fixture records never enter production.
- No visual brand, owner colors, authentication, media access rules or external publishing behavior changed.

Migration `20260924030947_assets_retire_clip_workflow.sql` was applied to the existing Supabase project. All 32 production records, including their update timestamps, have the exact same combined checksum before and after (`34853059cf58a8604b4cd75397731c53`). There were no live clip jobs to archive. Security advisors are unchanged: eight informational private-table RLS notices and the existing leaked-password-protection warning. See [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
