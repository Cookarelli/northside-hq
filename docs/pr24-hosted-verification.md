# PR #24 hosted verification — October 20, 2026

The reviewed migration is now committed only to isolated staging following explicit user approval. Hosted database workflow, preservation, RLS and anonymous HTTP checks pass. Full authenticated browser acceptance awaits an approved staging staff login. No application deployment, production migration, merge or automatic publishing activation occurred.

## Targets and baseline

- Production: `yogdhpfattuxicwyxylb`, Northside HQ / Northside Collectibles (`gsqesaepygorbhzncbxr`). All production SQL used explicit repeatable-read, read-only transactions with bounded statement and lock timeouts.
- Staging: `mmsltytdvskkavuctpas`, confirmed in the parent's branch list as `social-agent-staging`. It is a separate preview database, not production. Its dashboard remains **Unhealthy** with a failed branch migration workflow dated October 16; database queries and this verification succeeded. No reset or infrastructure change was attempted.
- The signed-in Supabase dashboard provided access. The two existing connector accounts still point elsewhere; reconnecting the connector is not complete.
- Production has 28 recorded migrations through `20261002134057_hq_record_deletion`. Staging previously had the same history plus the existing `social_agent_engine` and `meta_integration` migrations. It now has one additional entry, `20261020050107_daily_social_production`, for 31 total. The unrelated features were not merged or activated.
- `20260921193000_requests_notes.sql` exists in the repository but is absent from both remote ledgers. Do not blindly push the whole migration directory or mark historical files applied. The new feature's 15 critical function definitions, execution grants and search paths match the reviewed local baseline exactly; staging and production also match on audited core constraints, policies, table grants and bucket configuration.

## Production preservation

The hosted inventory contains 151 organization-scoped records: 95 deliverables, 19 posts, 17 projects, nine assets, nine upload metadata records, one auction campaign and one request. The original 142 app-visible non-upload count agrees with this database inventory.

There are eight verified Auth users, eight active staff and eight agreement acceptance rows. Both `marketing-assets` and `employee-agreements` remain private; their object counts are nine and one respectively.

Before/after comparisons are identical for audited record content fingerprints, object metadata fingerprints, bucket settings, Auth/staff/acceptance counts, migration history, core function fingerprints, constraints, policies and grants. No PR feature tables or RPC exist in production. No historical content, approval, campaign, storage object or user was edited by these checks.

## Hosted staging migration and workflow

### Initial rollback verification

The reviewed migration `20261020050107_daily_social_production.sql` has SHA-256 `4a7b60a6dbeba7742e087d4ebfe5546279fbb1520a96002112cb5a57a1742ef8`. Its SQL statements were executed in staging with the terminal commit replaced by rollback after the acceptance assertions. Synthetic fixtures used reserved QA organizations and `example.test` identities; no external publishing call occurred.

The hosted PostgreSQL result was **PASS** for:

- Draft creation, retry idempotency, explicit classification and canonical data preservation.
- Stale-version rejection, production progression, required final material/caption, and current-version approval.
- Separate Facebook/Instagram feed facts, source-linked Story reposts, authorized Story confirmation, and immutable published Story facts.
- Append-only metric observations, idempotent retries, null unknown metrics and rejection of metrics for an unpublished destination.
- Anonymous denial, direct-write denial, unsigned agreement gates and cross-organization RLS isolation.
- Rollback of both feature schema and all synthetic users, organizations, agreements, publications and metrics.

A separate post-test hosted query confirmed that the feature tables/RPC were absent at that point, Auth still had two users, and every audited staging baseline field matched its pre-test value. Migration history was unchanged. The test passed using database roles and synthetic JWT subject settings; this is not a claim that hosted OAuth, browser sessions, actual Storage HTTP uploads or independent-session request contention passed.

### Approved persistent staging migration

The user subsequently approved **staging database migration only**. A new read-only preflight reconfirmed the isolated project, unchanged critical function fingerprints, absent feature objects and absent migration version. The exact reviewed SQL and its migration ledger entry committed atomically through the signed-in SQL editor at `2026-10-20T14:26:53Z`. The stored source hash matches the reviewed migration byte for byte. No other migration was replayed or marked applied.

The workflow/RLS smoke test passed again against the committed schema; all synthetic fixture rows rolled back while the approved feature schema remained. A separate inventory confirms zero daily content/metric rows, unchanged existing record/storage/Auth/staff/agreement aggregates, unchanged existing core functions, both new tables protected by RLS with checked read-only grants, and all 18 audited function definitions/grants matching the full local baseline. Anonymous HTTP requests using the existing publishable key return `401` / `42501` for both feature tables and the RPC. The same key successfully reads public Auth settings, distinguishing permission denial from a bad key. The local daily API returns `401` without a session.

A production compilation with staging public configuration passed. The reviewed application is running locally on loopback at `http://127.0.0.1:3174/login`, connected only to `mmsltytdvskkavuctpas`. No service-role/secret key was accessed, no deployed environment variable was changed, and local connection settings remain outside the repository. The browser correctly redirects an unauthenticated dashboard request to sign-in. The user must supply the approved staging session and personally review any agreement gate; no session or agreement was fabricated.

## Existing operational findings

| Target | Security Advisor | Performance Advisor |
| --- | --- | --- |
| Production | 0 errors, 1 warning, 8 informational suggestions | 0 errors, 0 warnings, 7 informational suggestions |
| Staging, after approved migration and linter rerun | 0 errors, 1 warning, 11 informational suggestions | 0 errors, 0 warnings, 25 informational suggestions |

Both security warnings identify disabled leaked-password protection. Review [Supabase's password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) before changing Auth settings. The informational no-policy notices concern private tables accessed through checked functions; direct access remains denied. Other existing suggestions include unused indexes, three staging foreign-key index suggestions in the unrelated Meta/social schema, and Auth connection allocation. No existing indexes, policies or Auth settings were changed. New-table RLS/grants were verified both in the rollback test and after committing the approved migration.

The additional performance suggestion is [an informational foreign-key covering-index notice](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0001_unindexed_foreign_keys) for `hq_daily_content(org_id,record_kind,deliverable_id)`. A bounded hosted `EXPLAIN` of that three-column lookup uses `hq_daily_content_pkey` on `(org_id,deliverable_id)`, estimates one row, and filters the check-constrained constant `record_kind='deliverable'`. This is evidence of an available indexed lookup, not a workload benchmark. The notice remains visible; no extra index or migration was silently applied. PostgreSQL explains that [referencing-side indexes depend on the access pattern](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK). Reconsider the design if the fixed record kind or uniqueness changes.

Production displayed approximately 95% CPU with a high-resource alert **before** the PR checks. Its selected one-hour Postgres log view showed roughly 359,000 entries, and the visible recent sample repeatedly reported SQLSTATE `40001` (stale-record / reload-before-saving errors). This warrants investigation before production release. The caller and cause of the repeated writes are not established; these logs do not prove a particular retry loop or data loss. The existing five-minute reminder job's five most recent runs succeeded in under one second each. No production job, process or compute size was changed.

## Remaining acceptance and release gates

1. Staging-only migration approval is fulfilled. Production migration and any application deployment still require separate approval.
2. Sign into the prepared local staging app using an existing approved staging staff account, then test actual sign-in/agreement gating, private-media upload and review, daily creation, approval, platform/Story confirmations, metric save/reload and independent-session stale-write/contention behavior. Credentials must be entered by the user or supplied through an approved secret mechanism, never pasted into chat or committed. Keep all test work clearly labeled synthetic and confined to staging.
3. Investigate the existing production CPU/error volume and the staging branch's failed-workflow health label. Do not reset production or replay historical migrations as a repair shortcut.
4. PR #24 remains draft and unmerged. Vercel lists zero deployments for `codex/daily-social-production-20261020`; automatic Git deployments remain disabled. A separate explicit approval is required for any application deployment or production migration.

The application code remains the locally verified implementation (224 passing tests, typecheck/build pass, zero lint errors). This follow-up records the approved staging migration and hosted evidence; it does not relabel the earlier local browser test as a hosted browser test.
