# Direct media uploads and Jon’s review workflow

Built from main `2f86e35` plus the four-tab navigation branch (PR #18). This PR is stacked on `codex/four-primary-tabs` while #18 remains open.

Projects and individual deliverables now have **Upload photos/videos**. The existing ticket → private storage transfer → finalization pipeline carries a validated destination. Finalization creates the asset and assignment in one transaction; it never creates a deliverable. The same asset ID and private bytes appear in Assets, Jon’s Content, project media and deliverable media. Existing generic uploads, editor attachments and reassignment controls remain available.

Jon’s photos/videos show **In Review → Approved → Waiting → Completed**. Assignment remains separate. Only the verified active staff IDs `joey`, `steve`, `brody`, and `nick` can approve. `nikb` is Nik and has no reviewer access. No staff roles or administrator permissions change. Waiting is an explicit action using the existing deliverable publishing authorization. Completion requires the exact immutable asset in every platform’s recorded final package; reference files, other work and the project remain unchanged. Deliverable approval, budget checks and manual publication confirmations still apply.

Storage objects cannot be overwritten. Replacing media means a new asset ID, which starts In Review and cannot inherit the previous file’s approval. Assignment, review and completion changes use the existing activity log. Approval notes, uploader provenance and publication evidence are retained.

## Validation

- `pnpm test`: **194 tests passed**.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with the same three pre-existing internal-navigation warnings in agreement actions, login and sign-out.
- `pnpm build`: passed (production webpack build).
- `git diff --check`: passed.
- Real API handlers were tested with their actual identity/origin checks and validation, replacing only the Supabase transport with the migrated PostgreSQL fixture. Direct RPC and API attempts verify all four allowed reviewers and reject Jon, Nik, unrelated staff, inactive staff, unsigned staff, anonymous and foreign-workspace access. Stale versions and forged identity/status fields are rejected.
- Database tests cover automatic project/child attachment, finalization retries, one asset/storage object, immutable replacement, assignment history, explicit Waiting, ordinary publishing access, partial versus all-platform publication, unrelated media, and reassignment after completion.
- Migration tests cover current-version approval evidence, unproven work remaining In Review, preserved review/upload notes, partial publication, legitimately completed legacy work without an invented media approval, and repeatability.

## Browser verification

Used an isolated local Next.js preview with the real components and migrated PostgreSQL functions. Preview-only identity/storage transport adapters live outside the repository; production authentication and storage code were not bypassed or changed.

Verified light mode at **1280 × 900** and **390 × 844**:

- Home, Calendar, Projects, Assets and Settings load with exactly four primary tabs, correct headings, no horizontal page overflow and no browser errors.
- Project media includes project-level uploads and child deliverable media. Deliverable uploads appear only at their exact destination and in the shared libraries.
- A photo/video batch recovered from an intentionally interrupted transfer. Three uploads produced three assets and three stored objects. The recovered video’s SHA-256 matched the original bytes.
- Brody approved from Jon’s Content, leaving Approved visible; Mark Waiting required another explicit action.
- Manual Facebook confirmation left the file Waiting. Manual Instagram confirmation changed only that final file to Completed. A reference video and project-level image remained In Review.
- Jon’s Content, Assets, project media, deliverable media and the publishing package displayed consistent statuses and destination links. Mobile controls remained usable.

## Migration and rollout

Apply `20260924175937_direct_media_review.sql` before deploying the application change. It adds JSON metadata and named functions/triggers to the existing record system; no new tables, buckets, administrator roles or social integrations. It conservatively backfills existing Jon photos/videos using recorded evidence, and leaves existing publication records intact.

No production migration or deployment was performed for this PR. Hosted Auth and real Storage transfers were not mutated during verification; their existing private bucket policies and immutable-upload configuration are preserved.
