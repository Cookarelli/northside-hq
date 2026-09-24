# Category navigation and Assets

The top-level categories remain Home, Calendar, Projects, My Assignments, Requests and Assets. All are visible in a horizontal main navigation; mobile users can scroll it horizontally. Shared `HqSubnavigation` links use Next.js navigation and `?tab=`. Only the selected major area mounts. Native link keyboard support, visible focus, aria-current, open-in-new-tab, browser history and query preservation are retained.

| Category | Major areas |
| --- | --- |
| Home | My work, Schedule, Active projects, Recent activity |
| Projects | Projects, Deliverables, Handoffs, Launch plan, Tracked links, Results, Permissions |
| Project detail | Overview, Deliverables, Assets, Budget, Notes |
| Calendar | Schedule, Date planning, Entries & series, Releases |
| My Assignments | Active work, Completed, My projects |
| Requests | General requests, Editorial queue, Top stories, Stories, Products, Staff access |
| Assets | All Assets, Jon’s Content |
| Research subpage | Feed, Releases, Chase Cards, Drafts, Sources |

Small controls (status, filters, calendar month/week/day, record editors) remain in context. Project Assets includes attached deliverable files; Budget includes auction financial rollups plus existing project budgets/spend. Auction reminder links from Calendar, Home and project cards open the permanent parent’s Deliverables tab with the selected reminder expanded. Older reminder links without tab still open Deliverables. Legacy root hashes and project tool hashes map to query tabs; the existing Requests `view` query remains supported.

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
