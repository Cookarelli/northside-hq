# Content intelligence and analytics

Implementation checkpoint: 2026-10-17. This is a review-only extension of Content Radar and HQ reporting, not an autonomous publisher. Open **Assets > Research > Content intelligence**, or `/assets/research/intelligence`. The existing research desk, editorial queue, calendar, weekly auctions, assets, staff roles and approvals remain authoritative.

## Branch and rollout boundary

- Feature branch: `codex/content-intelligence-analytics`.
- Stacked on `feature/meta-integration` at `9ee2c34d6029c385d19f44ef42b67340dc5ed9bf` (PR #22), which depends on the shared social engine (PR #21). The draft PR targets the Meta integration branch to keep its diff independent. Retarget to `main` after the dependencies merge and re-run verification.
- No changes to `lib/social`, `lib/meta`, worker endpoints, package dependencies or existing migrations. The new snapshot trigger observes the existing Meta adapter without changing its latest-row contract.
- No hosted migrations, deployments, real Meta calls, publishing, worker activation, spending, inventory, purchases or production budget changes were performed.
- Daily/weekly generation and Meta collection are explicit manual actions. Source cadence controls due eligibility; it does not install a scheduler or turn on the shared worker. Any later unattended scheduling needs a separately reviewed integration with the existing engine.

## Sources and evidence

The existing source model now includes enable/disable, priority, collection cadence (60 minutes to seven days), last attempt/success, freshness and error history. Source settings accept an explicit feed URL on the same approved publisher domain. Existing source IDs and settings survive recommended-source seeding.

Recommended sources include Topps Ripped and the official Topps release calendar, [Fanatics news](https://www.fanaticsinc.com/press-releases/), [Fanatics Collect](https://www.fanaticscollect.com/newsroom), [Dave & Adam's](https://www.dacardworld.com/blog/), and [Steel City Collectibles](https://www.steelcitycollectibles.com/). These are configurable starting points, not a claim that each publisher offers a supported feed. No feed/API endpoints were guessed. RSS/Atom and publisher-advertised feed discovery use the existing parser and transport. New private/commercial APIs need a documented contract and licensed credentials before an adapter is added.

Automatic page-entry extraction is off by default. Staff must record publisher permission before enabling bounded fallback. Robots checks, host allowlists, redirect validation, time/response limits and source leases remain enforced. Feed discovery may inspect one permitted index page for advertised feeds; no recursive crawling or article-body harvesting is added. Collection retains at most 20 entries per batch and resumes with the existing cursor. Manual links remain available when a feed, permission or usable metadata is absent. Existing explicit single-link metadata lookup is retained.

Card Ladder is a manual licensed-source watchlist entry, excluded from outbound fetch authorization. Its [terms](https://www.cardladder.com/terms) do not provide blanket commercial scraping permission. A written license and supported data-access contract are prerequisites; this PR does not implement a speculative Card Ladder API. No Facebook or Instagram scraping is allowed.

## Briefings and handoffs

Daily briefing generation ranks saved Radar evidence and product/research context. It proposes up to five ideas, targeting three to five when enough evidence exists. It returns fewer rather than fabricating news. Each idea contains its headline, requested content category, source link/date (explicitly unknown if only an imminent event is dated), current relevance, Chicago posting window, confidence/verification, existing Northside template, owned-image/inventory checks, and separate Facebook/Instagram draft copy.

Sports, releases, chase cards, consignment, auctions, Pokemon, entertainment and store promotions have explicit category paths. Templates reuse `community-source` and `collector-question`, including the creator's configured preference; no shared agent drafting logic is replaced. Source headlines remain attributed drafts, not independent confirmation of availability, results, prices or transactions.

Posting windows consider existing posts, canonical deliverables, recurring Tuesday slots, Chicago offsets and a three-post daily capacity. Suggestions can extend into the next week; they are calendar gaps, not proven optimal times. Saved reports are immutable snapshots. Explicit handoff reuses a source's existing editorial record, validates current source evidence and preserves human edits. Calendar handoff creates only a `draft` in the existing calendar, reuses prior Radar mappings, and avoids duplicating already-adopted canonical deliverables. It never approves, publishes, spends, changes auction schedules or enqueues a publisher.

## Meta ingestion

Reuses PR #22's fixed-host Graph transport, approved v26.0 configuration and encrypted credentials. Setup/consent still follows [Meta integration](meta-integration.md). An accepted-agreement HQ administrator can run bounded read-only batches without enabling workers:

1. **Next history page:** 25 published posts/media per request; persist the opaque `after` cursor, ignoring provider `paging.next` URLs. A completed historical sweep stays complete.
2. **Current posts batch:** Facebook uses a fixed sweep upper bound and a 48-hour overlap before the last completed watermark. Instagram uses a cursor walk and stable-ID upserts, because its media edge does not share Facebook's `since` contract. The first current sweep is full history if no watermark exists.
3. **Next post insights:** one imported published post per request, keyset-paginated by provider ID. Each metric is queried independently; unsupported fields remain unavailable. Finishing a sweep allows another after cooldown.

Post import and metric snapshots are separate passes. Historical posts can be retrieved, but historical daily metrics cannot be invented: insights collected now are observations made now. Existing `meta_insights` rows are copied once, and future shared-adapter observations append snapshots. Repeated snapshots are never summed as separate posts.

Independent sync state has two-minute leases, actor checks, token fencing, ten-second successful-batch cooldown and fifteen-minute error cooldown. Expired runs become interrupted; failure does not advance cursors or save partial metric batches. Each request has a 55-second Graph budget within the route's 60-second maximum. The transport limits each response to 2 MB and each call to seven seconds. No automatic retry loop is created. Error history contains allowlisted codes, never provider bodies, credentials or authorization URLs.

## Metric semantics

Views, impressions, reach, likes, reactions, comments, shares and saves remain distinct. Missing data is `null`/Unavailable, never assumed zero. Current Facebook post collection reads views, reactions and separate comment/share summaries. Current Instagram media collection reads views, reach, likes, comments, saves and shares when available. Non-lifetime insight periods are excluded from lifetime post totals.

Deprecated impressions and unsupported current paid/organic breakdowns are not requested or substituted with views. Historical provider observations can retain distinct paid/organic impression and reach values. Paid/organic view fields remain unavailable until a reviewed supported profile supplies them. This is not a new Ads Insights connector.

Date-range comparisons are **publication cohorts in America/Chicago using latest observed lifetime metrics**, not engagement accrued inside the selected dates. Unequal post ages bias comparisons. Summed post reach is explicitly non-unique across posts; account audience size and unique aggregate reach cannot be inferred. Comparison deltas require complete coverage; zero baselines have no percentage change. Counts and coverage are visible alongside totals.

Channel/category/format/template/schedule recommendations compare shares per post within one platform, requiring at least three observations in the candidate group and three elsewhere. They display both averages and sample sizes, and are descriptive experiments rather than causal or statistically proven lift. Daily and weekly reports preserve the supporting totals and can hand recommendations into the same review/draft workflow.

Post campaign/auction labels reference real same-workspace project/campaign IDs with optimistic locking. Project and campaign identities remain distinct even when their IDs match. Explicit one-to-one mappings link these records to existing manual daily reporting campaign keys; names are never guessed. Spend/results uses those existing reporting records, not production budget changes or inferred ad spend. Category filters do not allocate spend. CPC requires complete spend/click coverage. Confirmed sales ROI is always unavailable because attributable sales or realized-profit evidence is not connected.

## Storage and permissions

Apply only pending migrations, in order, after reviewing the isolated target's migration history. The additive migration `20261016184748_content_intelligence_analytics.sql` depends on the existing HQ, social-engine and Meta migrations. It adds five public RLS tables (`intelligence_reports`, `intelligence_labels`, `intelligence_campaign_links`, `meta_analytics_snapshots`, `intelligence_sync_runs`), one private sync-state table, a security-invoker post view and checked RPCs. Source controls extend the existing Radar RPC rather than replacing records.

Browser roles have organization-scoped SELECT access only; checked functions enforce staff membership, agreement acceptance, same-workspace references and version checks. Only the server service role can call the manual sync broker, which rechecks the original admin. Private credentials and leases are not exposed. The API additionally checks same-origin mutation requests, schema/body size and agreement state, and returns no-store responses. See [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Read bounds are explicit: up to 10,000 posts, labels, reporting/calendar rows and snapshots each; 30 saved reports, 50 recent sync runs, 100 connections, 1,000 campaign mappings and 200 recent snapshot details. Briefings use at most 1,000 recent research and 1,000 detail/product records. Hitting a reporting bound marks totals partial and withholds recommendations. Selecting narrower dates does not bypass the storage cap: an approved server-side aggregate/latest-snapshot query is required before scaling beyond it. Historical records are retained, not deleted. Agree a retention/deletion policy before external onboarding; no automatic purge is included.

## Configuration and manual gates

No new environment variables. Reuse the intended isolated staging project's configuration; values and secrets must not enter reports, client code or Git:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
META_APP_ID
META_APP_SECRET
META_TOKEN_ENCRYPTION_KEY
META_REDIRECT_URI
META_GRAPH_VERSION
```

Keep `SOCIAL_WORKER_ENABLED` disabled. This feature needs neither a worker secret nor a scheduling change. Required live gates remain:

1. Review/merge the dependency stack and review this migration; apply it only to an approved isolated staging project. Never reset the existing database or seed production.
2. Configure staging Auth, existing staff memberships and the private agreement document without bypassing the agreement gate.
3. Configure the approved Meta app, exact redirect, authorized Page/Professional Instagram account, permissions and any App Review requirements. Follow the parent integration's credential logging/redaction and retention instructions.
4. Perform real consent, history/current/insight passes and rate-limit/reconnect checks. Confirm provider metrics and dates against Meta. Mocked local checks are not evidence of live account access.
5. Confirm each publisher's supported feed or documented permission. Card Ladder remains manual until licensed access is agreed.
6. Verify staff/admin/foreign-organization access and a draft handoff with approved staging records. Confirm no publisher task, worker switch or budget write occurred. Obtain production approval before any merge/deployment.

## Verification

Local checks on Node 25.8.2 (repository requirement: Node >=22.13):

```sh
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js app components lib proxy.ts --ignore-pattern components/ui
node node_modules/next/dist/bin/next build --webpack
git diff --check
```

These are the repository script equivalents. The pinned pnpm install completed with the frozen lockfile; subsequent sandboxed pnpm command startup could not reach its registry signature service, so checks invoked the already-installed binaries without disabling signature verification.

The full test suite passes 274 tests (241 existing, 33 added), including migration replay through the existing PGlite harness, organization/RLS checks, authenticated API commands, cursor/error behavior, source restrictions, no invented metrics/ROI, calendar retry preservation and component interactions. TypeScript and the production webpack build pass; ESLint has zero errors and three existing internal-navigation warnings outside this change. A scan of 84 compiled client JavaScript files found no server-secret identifiers or common credential patterns; this is not a comprehensive secrets audit. UI verification uses the real component with isolated fixtures, actual button/input components and production CSS; navigation is stubbed. Desktop/mobile rendered fixtures cover all four views, overflow and brand-image loading. They are explicitly labeled test data, not live analytics. A real local app without environment configuration remains setup-gated. Live browser-to-Supabase-to-Meta verification is blocked on the staging gates above.

Fixture rendering can be reproduced without credentials after building:

```sh
INTELLIGENCE_VISUAL_DIR=/private/tmp/northside-intelligence-qa node --test tests/content-intelligence-ui.test.mjs
```
