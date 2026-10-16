# Social Agent Engine

Social Command Center lives at `/assets/social` in the existing HQ shell. The header links to it without replacing the four primary navigation areas. Branch: `feature/social-agent-engine`.

## Inspection and scope

Inspected Content Radar collectors/repositories, editorial models and RPCs, calendar handoff, HQ assignments, asset ownership/review, the complete migration chain, and current staff/agreement authorization. The new migration is additive and does not modify customer-app or Books code, existing records, calendars, assignments, assets, staff roles, or prior migrations.

The repository records Supabase project `sjbjotfzsnaolecxklxr` and Vercel project `marketinghub-7vl1` (`prj_LXzzmca1PSTuFXKQowPNbC5qEAnO`, team `team_iPL9ti94DMgRhfyzvbgjzZdG`). GitHub confirms the HQ repository and deployment homepage. On 2026-10-16 the connected Supabase account denied reads of this project and the Vercel connector returned 403 for its team. No Vercel CLI is available locally. Therefore the repository's full schema was inspected and replayed in PostgreSQL/PGlite, but live schema drift, current hosting plan, environment settings, live staff sessions and deployed scheduler state remain unverified. No production migrations or deployment were performed.

## What operates after configuration

- One organization-scoped database queue serves five defined agent roles. Staff see the same persisted state through existing RLS; only current administrators can operate agents or approve publication. The existing employee agreement gate also applies.
- Trend Scout turns up to ten existing, non-dismissed Content Radar stories per run into evidence-backed ideas. It reuses Radar's save-idea operation, canonical source records and editorial queue. Refresh external research through the existing Research & sources collector; this worker does not implement a second crawler.
- Content Creator creates starter copy from one of two selectable Northside templates. It never overwrites an existing draft that has moved beyond Saved. These are deterministic templates, not an LLM integration.
- Quality Control is a separate task and records exact-version checks for recorded fact verification, source evidence, duplicate captions, required content and rights. It checks the existing staff verification record; it does not claim to independently establish truth from the internet. A human must verify source facts in Radar. Duplicate detection is normalized exact-caption comparison, not semantic similarity.
- Human approval requires a passing QC result for the current revision and rechecks source/duplicate changes. It calls the existing administrator editorial-approval RPC, preserving all existing approval requirements. A separate immutable approval binds the resulting approved version to the reviewer.
- Schedule jobs call the existing calendar RPC and reference its `radar_<queueId>` record. Existing assignments and assets continue through the editorial workflow. Staff edit the date in the editorial queue (America/Chicago); scheduling rejects past dates. Each scheduled platform post is unique to its queue, revision and platform.
- The dependency chain is Research → Draft → QC → human approval → Schedule → Publish → Verify → Analyze. The last three stages are intentionally blocked until actual platform integrations are implemented. Publication attempts record `disabled`, with no receipt, external ID or fabricated metrics.

No production simulation mode, seeded fake activity, autonomous ad buying or live social-account calls are included. Tests use explicitly synthetic fixtures only.

## Data and safety boundaries

Migration: `supabase/migrations/20261016133436_social_agent_engine.sql`.

| Table | Responsibility |
| --- | --- |
| social_agents | Five roles, pause state, template and research schedule configuration |
| social_tasks / social_dependencies | Durable shared queue, idempotency key, attempts, dependency graph, lease token and expiry |
| social_runs | Attempt status, elapsed duration and safe error code |
| social_ideas | Reference to existing Radar story and captured evidence |
| social_revisions / social_reviews | Immutable draft snapshots and independent checks |
| social_approvals | Immutable administrator approval of a specific revision |
| social_posts | Platform schedule linked to the existing calendar record |
| social_publication_attempts | Attempt outcomes and future platform receipts |
| social_analytics | Future real metrics snapshots and recommendations |
| social_activity | Immutable operational events and execution logs |

All public tables have RLS and explicit grants. Clients receive SELECT only; checked commands derive organization and actor from the existing staff + agreement functions. Worker RPCs are executable only by `service_role`; service credentials never enter client code. Internal functions have empty search paths and explicitly revoked default EXECUTE privileges. Cross-organization relations use compound foreign keys. No new broad service-role table grants are introduced.

Claiming locks the task and agent row with `FOR UPDATE SKIP LOCKED`. A random token fences every completion; an expired or already-completed lease cannot commit. Built-in effects and task completion occur in one transaction. An interrupted transaction rolls back; a committed response lost in transport is harmless to replay. Leases last 60 seconds. Recovery scans at most 100 expired leases per claim, with a 30-second recovery delay. Execution failures retry with exponential backoff up to one hour and become dead letters after five attempts. Manual retries retain the attempt count. Blocked jobs require resolving the cause first; failed dependencies block descendants. A retried parent must succeed before descendants can be retried.

Claims are limited to one per agent per two seconds. Manual enqueue is limited to 30 recent tasks per organization per minute. A worker invocation admits at most eight jobs within a 40-second admission budget, uses seven-second RPC transport timeouts, and has a 60-second route limit. PostgreSQL functions declare a five-second statement timeout; configure the database/PostgREST role-level statement timeout as well before activation. External request errors are not logged verbatim, and saved error codes contain no credentials or provider payloads.

Scheduled work carries the administrator who enabled it. At execution the worker restores that identity transaction-locally and rechecks current roster, role and agreement eligibility. Revocation blocks already queued jobs. Pause prevents new claims and also stops an already-claimed job before its effects execute. Draft edits create a new immutable revision and block older scheduled engine posts. Existing editorial history and approval invalidation remain in force.

## Setup and execution

1. Reconnect to the **existing HQ** Supabase and Vercel projects above. Compare the live migration history/schema with this branch before applying anything. Do not create a replacement database.
2. Run the additive migration against an isolated copy/staging environment first. Run the tests below and Supabase security advisors. Review RLS, worker EXECUTE grants and the live statement-timeout configuration. Apply the reviewed migration to HQ through its normal migration process.
3. In Vercel's server-only environment settings, configure `SUPABASE_SERVICE_ROLE_KEY`, a strong random `CRON_SECRET`, and `SOCIAL_WORKER_ENABLED=true`. Keep the existing public Supabase URL/publishable key. Never prefix the service key or cron secret with `NEXT_PUBLIC_`, commit them, print them, or copy them into a browser. The default is disabled.
4. Deploy the branch to a staging/preview environment for staff smoke tests first. Vercel cron runs on production deployments. `vercel.json` prepares a daily wake-up at **06:00 UTC**, a conservative cadence compatible with daily-only hosting plans. It calls `/api/social/worker` with Vercel's cron authorization. More frequent processing requires confirming the actual plan and changing the cron cadence; the UI's desired research interval does not change hosting frequency.
5. Open Social Command Center as an administrator. Resume the needed roles; select a template. Add/refresh real research through Research & sources. Choose Queue run for Trend Scout or enable its daily research schedule. Workers drain persisted jobs even with all browsers closed. The dashboard's 15-second refresh only reads state.
6. To drain manually from a trusted operator environment, send an authenticated GET to `/api/social/worker`, using the same secret through your secret manager. Do not paste credentials into logs or the browser. A disabled worker returns `{state:"disabled",processed:0}`. An enabled invocation returns the actual processed count.
7. Review and edit the existing editorial draft, verify facts, select assets/rights and the calendar date. Select that draft in Social Command Center and queue Quality Control. After it passes, approve the exact revision. The next worker drain creates the shared calendar entry. Due publication jobs stop as `live_publishing_disabled`.
8. Verify two authorized staff sessions see the same state, a staff user cannot operate administrator controls, an unsigned/revoked user is denied, and changing approved content prevents scheduling its old revision. These live smoke tests are still outstanding because project access was denied.

No separate generic retry button can bypass approval or enable live publishing. Keep live publishing disabled in this release.

## Worker interfaces and future platform adapters

`lib/social/worker.ts` defines the store/lease drain contract and future publication, verification and analytics adapter interfaces. The route is a thin authenticated dispatcher; SQL owns all current effects and safety gates. The extension interfaces are **not wired to live providers**.

Before implementing real publication, add a separately reviewed transactional outbox boundary: reserve one immutable post revision, recheck current approval/source/asset state, use the provider's idempotency key where supported, and persist the provider receipt. If a provider call times out after potentially accepting the post, mark the attempt uncertain and reconcile by stable external identifier before any retry. A database lease alone cannot guarantee exactly-once effects across an external API. Verification must confirm the real remote post before Analytics is admitted. Read real metrics with provider rate limits, observation timestamps and bounded requests. Store tokens only in protected server credentials; never in `social_agents.config`, tasks, activity or receipts. This release deliberately contains no switch that turns live publication on.

LLM generation, semantic duplicate checks, direct fact retrieval, platform OAuth scopes/accounts and live analytics adapters remain configuration/implementation work for a later authorized release. The dashboard labels these limits and shows honest empty states.

## Verification

```sh
corepack pnpm install --frozen-lockfile
npm run typecheck
npm run lint
npm test
npm run build
```

The full suite replays existing and new migrations in PGlite. New tests exercise authorization/RLS/agreement boundaries, the research-to-calendar flow, preserved human edits and exact revisions, idempotency, lease fencing, bounded retries/dead letters, revoked staff, duplicates/evidence changes, scheduler deduplication, worker authentication, API origin validation and role-based dashboard controls. PGlite validates SQL and sequential competing claims; a real multi-connection Postgres contention/load test remains part of staging acceptance.

Dashboard panels intentionally bound recent records (50 ideas/activity/analytics, 100 jobs/reviews/posts/drafts). Agent last-execution/current-task status is queried independently of that recent window. Historical data remains persisted in the database.

To stop execution, disable `SOCIAL_WORKER_ENABLED` and pause agents. Leave the additive tables/history in place; do not roll back by dropping operational data.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Postgres locking](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE), [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
