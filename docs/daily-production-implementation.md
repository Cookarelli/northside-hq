# Daily production implementation report — October 20, 2026

## Delivered for review

Branch: `codex/daily-social-production-20261020`, based on production `main` at `ac05ca16120d12e96db181c2cf21641bfdd3f865`. This implementation is not deployed and its migration is not applied to production.

The [initial audit](daily-production-audit.md) documents the current functionality, live application inventory, weekly cadence and gaps before implementation. The [Meta audit](meta-prerequisites-audit.md) distinguishes verified source behavior from account/app permissions still requiring evidence.

The shared header now links to `/projects/production`. The date is bookmarkable with `?day=YYYY-MM-DD` and uses America/Chicago. The board follows the intended feed publication day, including reschedules and imported dates with explicit UTC offsets.

| Date | Video originals | Static/carousel originals | Facebook Story reposts | Instagram Story reposts |
| --- | ---: | ---: | ---: | ---: |
| October 20–November 2, 2026 | 3 | 3 | 6 | 6 |
| From November 3, 2026 | 4 | 4 | 8 | 8 |

These dates reflect the user's confirmed schedule. Each Story is a repost linked to its original. One deliverable counts once across all feed platforms; Stories and repurposes never add to original totals. The board distinguishes planned originals, current approvals and fully confirmed publication on every selected destination. Targets do not create rows or imply publication.

## Workflow and preservation

- Six reusable pillar briefs use exactly **The New Northside**, **Northside Buys**, **Northside Sports Desk**, **Meet Northside**, **The Hobby Report**, and **Northside Collects**. Staff explicitly enter the working title, owner, approver, publisher, format, dates and destinations before creating one draft. Templates add no seeded content, campaigns, statuses or metrics.
- New drafts use the existing checked HQ deliverable writer. They retain final-file/caption requirements, assignments, notifications, asset handling, version-specific approval, calendar inclusion and manual per-platform feed confirmations.
- Existing publishing deliverables appear for their intended date. Assigned staff can explicitly classify them; classification does not alter the canonical record. Existing task-based weekly assignments remain in Projects and Calendar. They are not guessed to be original publishing work or converted automatically. Create an explicit publishing draft when needed.
- The existing weekday marketing projects, legacy calendar entries, auction reminders and source records are retained. The cadence panel links back to the authoritative saved schedule. No historical entry was adopted, shifted or renamed by this implementation.
- Each original has separate Facebook and Instagram Story confirmations. Staff must first confirm the original's publication on that platform, then record the Story's real status, time and URL or unavailable-link explanation. Only its publisher, approver or administrator can confirm the Story. Published Story facts are permanent; use existing comments for corrections. “Scheduled externally” records a verified external schedule; no job is dispatched.
- Metrics are append-only manual observations for published content and surface. Each retains observation time, reporting period/date, evidence URL, actor and available values. Missing values stay null/“Unavailable.” The board displays the latest observation per destination/surface and never sums snapshots; earlier observations remain in the database.
- Owner, pillar and production-state filters affect the work list while the scoreboard retains whole-day totals. Work links to the existing production editor, review controls and feed confirmations.

The README now corrects stale repository/database references using current deployed evidence. No existing auth, RLS, approval, calendar, project, asset, campaign, staff or agreement function was replaced.

## Additive database design

Migration: `supabase/migrations/20261020050107_daily_social_production.sql`, created with the official Supabase CLI 2.120.0, respecting the repository's minimum release-age policy.

Two new tables are isolated from existing record data:

| Object | Purpose |
| --- | --- |
| `hq_daily_content` | One organization-scoped classification per canonical deliverable; separate Story receipts, optimistic version, initial-create receipt and timestamps. Composite FK retains the original identity. |
| `hq_daily_metrics` | Immutable observations keyed by organization/request UUID, with destination, surface, observation time, period and evidence. |
| `hub_daily_production` / `private.daily_production` | Checked list/create/classify/Story/metrics actions. Existing verified-staff and agreement checks, workspace lock and canonical permissions are reused. |
| `private.daily_instant` | Correct Chicago wall-time and offset-bearing historical-date interpretation. No public execute grant. |

Both tables enable RLS. Browser roles receive organization-scoped SELECT only; all writes pass checked transactions. Anonymous RPC access and direct authenticated table writes are denied. Create and metric retries preserve the first result; changed retry payloads fail. Classification and Story commands check both classification and canonical record versions. Scheduled/published classifications are retained. The migration has a two-second lock timeout and contains no data backfill or changes to existing stored functions.

## Verification completed

| Check | Evidence |
| --- | --- |
| Baseline | All 211 existing tests passed before implementation. |
| Final regression suite | `pnpm test`: 224 passed, zero failed/skipped. Includes all existing tests and 13 new model/database/API checks. |
| TypeScript | `pnpm typecheck` passed. |
| Lint | `pnpm lint`: zero errors; three existing internal-auth-navigation warnings in unchanged components. |
| Production compilation | `pnpm build` passed with the new page/API; no deployed environment or secrets used. |
| Migration preservation | Exact migration applied to a populated isolated PostgreSQL fixture. Before/after comparisons preserve all existing canonical records, activity, comments, spend, notifications, storage objects/buckets, staff rows, agreement documents, assignments and acceptances. Both new tables start empty. |
| Authorization and data integrity | Anonymous, unsigned and foreign-org access; direct-write denial; assigned-staff checks; stale-version conflicts; idempotent creation; immutable published facts; unpublished/future metric rejection; null metrics; pagination past 50; imported offsets and both DST transitions. |
| Actual browser flow | Existing sign-in and agreement gate → new dashboard → create original → existing deliverable editor → final external material + caption → submit → approve exact version → separate Facebook/Instagram feed confirmations → separate Story receipts → metric observation → reload. UI and PostgreSQL agreed: one original, one repost per platform, observed views 123 with other values unavailable. |
| Quota boundary in browser | Dated November 3 page displayed 0/4 video, 0/4 static/carousel and 0/8 Stories per platform, with no fictional seeded work. |

Browser verification used a disposable localhost transport backed by real PGlite/PostgreSQL functions and clearly labeled synthetic records. No real social posts were created. The local transport, fake session and synthetic content are outside source control and are not deployable application features. Browser extension warnings were unrelated to HQ. Hosted OAuth, storage uploads and signed-in production mutations were not exercised.

Browser testing found and fixed optional blank Story URL validation; API regression coverage now verifies that blank URLs with explanations work and malformed URLs fail with 400. PostgreSQL tests also caught and fixed Chicago wall-time conversion before release review.

## Release gates — approval still required

1. The October 20 [hosted verification](pr24-hosted-verification.md) confirmed active production `yogdhpfattuxicwyxylb`, its history/security metadata/storage aggregates and matching critical function definitions. Before/after production inventories were identical. Investigate its existing CPU/stale-record error volume and reconcile the historical `requests_notes` ledger gap before release; do not blindly replay old migrations.
2. Isolated staging `mmsltytdvskkavuctpas` is confirmed. The exact new migration and database workflow/RLS tests passed in a fully rolled-back hosted transaction. Persistent staging schema changes and actual authenticated browser/private-upload/independent-session checks remain pending approval and an approved staging staff login. Do not use inactive `sjbjotfzsnaolecxklxr`, reset production, or treat the old failed staging branch workflow as resolved.
3. Review this draft PR and the manual workflow, including the user's Story repost interpretation. Inspect the screenshot as **local QA**, not evidence of published campaign results. Complete the Meta account/App Review evidence separately if future integration is requested.
4. `vercel.json` sets `git.deploymentEnabled: false`, using Vercel's documented [Git configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled). This prevents the requested draft PR/push from automatically deploying. Existing live project settings are unchanged. Remove or revise this guard only as part of an explicitly approved release; CLI/manual deployment also requires approval.
5. After explicit approval, take the normal backup/export, confirm production migration order and apply only this pending additive migration. Verify its grants/RLS and preservation queries, then release the reviewed build and perform an approved hosted smoke test. No destructive rollback is supplied: if UI rollback is needed, retain the added tables and all new records, and return to the previous reviewed app build.

No deployment, merge, live migration, Meta connection, worker activation or automatic publishing was performed as part of this task.
