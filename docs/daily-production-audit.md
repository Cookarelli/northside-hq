# Northside HQ audit — October 19, 2026

## Baseline and evidence

Audited before implementation: `Cookarelli/northside-hq`, `main` at `ac05ca16120d12e96db181c2cf21641bfdd3f865`. Vercel's production deployment `dpl_XwGiLUqknDZRGRWjjSNSUdTpg4Da` reports that same repository, branch and SHA as READY. The project remains `marketinghub-7vl1` (`prj_LXzzmca1PSTuFXKQowPNbC5qEAnO`), with `northsidebrand.com` and `www.northsidebrand.com` custom domains. Read-only HTTP checks returned 200 for `/login` and 401 for unauthenticated `/api/hq`. The existing signed-in Chrome session opened the production Home screen successfully; no production work was edited.

Vercel's latest deployment is a separate preview of `codex/content-intelligence-analytics` at `1ee54cad934622df885ed0cd7fecfe0a3d7567da`. Remote branches also contain Social Agent Engine and Meta work. These are not present on production `main`; this change must not merge or activate them implicitly. Their existing adapters hard-stop public publishing. See their branch documentation before integrating those proposals.

The README's Supabase reference `sjbjotfzsnaolecxklxr` is stale: that project is INACTIVE. Public login bundles and subsequent signed-in dashboard inspection confirm active production `yogdhpfattuxicwyxylb`. The October 20 hosted follow-up independently confirmed isolated staging `mmsltytdvskkavuctpas`, production migration history, core database security metadata and advisors. The new migration/workflow passed inside a staging transaction that rolled everything back. Actual hosted browser/Auth/private-upload acceptance remains pending; see [hosted verification](pr24-hosted-verification.md), including the existing production CPU/error alert and historical migration-ledger gap. Never apply migrations to the stale reference or infer that missing connector access means missing records.

On October 20, an authenticated, read-only `/api/records` inventory traversed all three pages (50 + 50 + 42). It contained 142 visible non-upload records: 95 deliverables, 17 projects, 19 calendar posts, 9 assets, 1 auction campaign and 1 request. These are application-visible rows, including retained work; they are not a physical database/storage inventory or a count of published content. No row was edited, adopted, classified, rescheduled or deleted. The weekday project titles and saved assignments establish the cadence below. An additional live metadata check remains necessary for private tables, migration reconciliation and storage objects.

## Current functionality to preserve

| Area | Existing behavior and source |
| --- | --- |
| Authentication | Individual verified Supabase sessions; active private staff roster; organization RLS; employee agreement gate; callback, invitation and password recovery routes. `lib/storage.ts`, `proxy.ts`, HQ layout and agreement migrations. |
| Home | My Assignments, schedule, active projects and recent activity; staff ownership, priorities, deadlines and notifications. Live Home shows historical overdue work and upcoming October assignments. |
| Projects | Projects, tasks, deliverables, members, accountable owners, approvers, budgets, spending and reconciliation, discussions, version checks, retained deletion history. |
| Production and approvals | Canonical `marketing_records` deliverables; To do → In progress → Needs review → Ready; current-version approval and final-file/caption requirements. Published facts are permanent. |
| Publishing | Separate per-platform planned/scheduled/published confirmations, publisher, timestamp, URL or reason unavailable; manual external publication. |
| Calendar | Shared production/publication dates, project milestones, legacy entries and weekly Tuesday series with retry-safe dated occurrences; no automatic backfill. Chicago timezone and DST validation. |
| Campaigns | Existing consignment evidence, auction reminders, permanent Collect Weekly Auctions home, campaign budgets and actuals; historical copies and explicit adoption. |
| Assets | Private immutable uploads, signed downloads, final/reference/draft roles, Jon's Content and direct media review; archived editing records retained. |
| Requests/research | Request decisions and handoff; Content Radar sources, editorial evidence, staff verification and explicit HQ adoption. |
| Marketing tools | Saved launch strategy, scenarios, tracked links and manually entered campaign results. |
| Store opening | Existing checklist and official November 20, 2026, 3 PM Chicago milestone. |

## Existing weekly cadence

Live Home confirms separate weekday marketing projects. Keep their saved records, assignments, dates, content and times authoritative:

- Monday: Collect Card of the Week recap and MNF cards in the shop.
- Tuesday: Fantasy Football Dream Team and Northside NFL Power Rankings; retain the legacy recurring Tuesday series as well.
- Wednesday: new product releases and Collect weekly sports/TCG spotlights.
- Thursday: TNF cards in the shop and Northside Locks.
- Friday: three things we are watching this weekend and the auction's 48-hour reminder.
- Saturday: college football/draft prospects and the auction's 24-hour reminder.
- Sunday: football/card conversation and the auction's 2-hour reminder.

The source's older Friday 9 AM Northside Locks description differs from current saved Thursday assignments. Preserve both source history and saved schedule; do not automatically move posts. Auction times derive from the actual campaign close, not a newly invented weekly schedule.

## Gaps and implementation decisions

1. No daily original-production quota or progress board. Add an opt-in tracker linked to canonical deliverables, with 3 videos + 3 static/carousel originals daily from October 20 through November 2, then 4 + 4 from November 3. The user explicitly confirmed this schedule during the audit.
2. No six-pillar classification. Use exactly The New Northside, Northside Buys, Northside Sports Desk, Meet Northside, The Hobby Report and Northside Collects.
3. Story requirements are not separate from feed originals. The user clarified that Stories are reposts of the six daily originals. Track each original's Facebook and Instagram Story confirmations separately: six per platform initially, eight from November 3. Stories do not create new original deliverables or increase original counts.
4. Cross-posts must not inflate original counts. One linked deliverable counts once; exclude Stories and repurposes. Planned, approved and fully published counts must be distinguished. Unclassified legacy records remain visible for explicit inclusion, never silently counted or rewritten.
5. Manual campaign metrics are not content/platform observation history. Add append-only metric snapshots with observation time, reporting period and evidence URL; unavailable values remain null. No fabricated metrics or posts.
6. Preserve approvals by continuing to use existing deliverable actions. Templates create explicit drafts only after staff submission, and are reusable briefs rather than seeded campaigns.
7. The active database reference and hosted validation are release gates. Local PostgreSQL tests can verify behavior without touching production. No migrations, background jobs, secrets or deployment are authorized for activation in this task.
8. Pushing any branch can trigger Vercel previews. Include a branch-local `vercel.json` Git deployment disable before pushing the requested draft PR; do not alter the live project's settings.

The implementation report records final validation, migration instructions and remaining hosted checks. This audit is a baseline; it does not assert that planned or overdue work was published.
