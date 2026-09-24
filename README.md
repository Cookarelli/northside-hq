# Northside HQ

Northside Collectibles' internal workspace for projects, production, approvals and manual publishing. Primary navigation: **Home, Calendar, Projects, My Assignments, Requests, Assets, Operations**. These views share organization-scoped project and deliverable records, preserving the existing calendar, recurring series, campaign evidence, editorial sources, private asset library, authentication and integrations.

Read [the workflow, staff onboarding, preserved-data inventory, permissions, verification and rollout guide](docs/northside-hq.md). Social publishing remains manual. In-app assignment/review notifications persist; deadline reminders are checked while HQ is open because no background scheduler is configured.

## Run and verify

Use Node 22.13 or newer and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm dev
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the intended environment. These are public application configuration; no service-role key is used. Keep credentials, private staff contacts and test sessions out of source control. Use an isolated test database for verification; never seed production with fictional work.

## Existing deployment and database

Continue with `Cookarelli/marketinghub`, the existing Vercel project `marketinghub-7vl1`, and the existing Supabase project. Do not import a replacement repository/project or reset the database. Apply only pending additive migrations after checking remote migration history, in the order documented in [the rollout guide](docs/northside-hq.md#additive-migrations-and-rollout). Preserve existing record IDs, workspace `northside-marketing`, private storage bucket and deployment connections.

Individual Auth logins require verified email plus active membership in `private.staff_access`. Database RLS and checked transaction functions enforce organization and workflow permissions; client metadata never grants access. Active project members, individual deliverable assignees and administrators can update deliverable status, approve submitted work and record publication confirmations. Configured budget approvers establish project budgets; involved staff record deliverable budgets and actual spending. Configured coordinators decide requests.

**Collect Weekly Auctions** is the permanent home for numbered auction campaigns. **Add Auction Campaign** suggests the next number and creates three reminders, with optional campaign and deliverable budgets. Campaign members can also work on their reminders. See [auction creation, calendar behavior, permissions and migration verification](docs/mj-consignment-deliverables.md#reusable-weekly-auction-campaigns).

Auction rows expose status, owner, due time and compact budget/actual totals. Open a reminder to enter channel spending or inspect its history. When all reminders are published and actuals are confirmed, **Reconcile Auction** records the reviewed totals; later financial changes reopen reconciliation. See [weekly operations and reconciliation](docs/mj-consignment-deliverables.md#weekly-usability-channel-spending-and-reconciliation).

Submit changes as a draft PR against `main`, verify a protected preview using isolated data, and obtain Steve's production approval before merge/deploy. The guide separates completed local checks from hosted rollout gates and the deferred repository rename.

## Retained tools

- **Calendar → Existing calendar entries and recurring series** retains the legacy editor. A Tuesday template creates one dated occurrence per Tuesday, safely reused on retry.
- **Projects → Store Open Checklist** is the temporary cross-department work hub with normal projects, direct or project deliverables, department/owner grouping and completion counts. Its previous strategy and budget plan remain available. See [the work hub guide](docs/store-open-work.md). Projects also retains campaign adoption, tracked links and manual reporting. Approved editorial sources can be handed off once to canonical HQ production with an explicit owner/approver.
- **Requests → Editorial queue** retains specialized content evidence and source approval. Source changes require renewed pending HQ approval.
- **Assets → All Assets / Jon’s Content** provides the private media library. Research & sources remains a linked subpage. The cutting/editing workflow is retired; historical jobs remain read-only in workspace exports.

See [password recovery](docs/password-recovery.md) and [consignment evidence and campaign behavior](docs/consignment-campaigns.md). Earlier deployment documents are historical checkpoints, not current production migration evidence. Shopify, ad accounts, AI generation, automatic transcription, external social publishing and in-app rendering remain unconnected.

### Category navigation

Northside HQ uses a horizontal top navigation and shared, URL-driven subnavigation. Major areas render only when selected; browser history, refresh, bookmarks and cross-page links preserve the selection. Project details use `?tab=overview|deliverables|assets|budget|notes`; Collect Weekly Auctions defaults to Deliverables. Calendar includes Schedule, Date planning, Entries & series and Releases. Home, Projects, My Assignments, Requests and Research use the same subnavigation component. Legacy hash and request-view links remain compatible.

Assets has exactly two category tabs: All Assets and Jon’s Content. Jon’s Content derives from authenticated uploader identity and assets attached to work assigned to Jon; unknown historical ownership is not guessed. Uploads keep the existing private bucket, immutable file IDs and retry-safe finalization. The archived renderer is retained under `docs/archive/`, outside active public routes.

See [navigation verification](docs/category-navigation.md) for the migration and verification scope.

See [category defaults, auction tabs, direct links and app-wide navigation verification](docs/category-navigation.md) for the shared category → tab/subpage → action navigation.
