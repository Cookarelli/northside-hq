# Request Notes

Request detail now shows Notes immediately below the request information. Staff can add multiline context and handoff updates using one Save note button. Notes show the staff name and creation time in America/Chicago, newest first; earlier pages remain available. Request creation/update/decision history is accessible in a compact disclosure.

Notes reuse `hq_comments` through the existing `/api/hq` history endpoint and `hub_hq_operations` comment command. Authors and workspace are resolved server-side from confirmed, active staff access. RLS restricts reads to that workspace; direct writes are revoked. The UI sends no mentions and generates no comment notifications. Existing notes are append-only because the existing permissions do not grant comment updates. No new Notes migration is needed.

The existing HQ workflow/design branch was integrated into main to restore the Request routes, model, API and migration history. The previously committed Calendar editor and Chicago day grouping remain at the top; the existing atomic Tuesday-template endpoint is retained. Existing HQ migrations must be present in any deployment using these routes. This change does not execute migrations or write production records.

Verification:
- 97 tests pass, including real PostgreSQL-compatible database checks for author attribution, multiline text, persistence after closing/reopening the database, multiple notes, idempotent retry and signed-out/foreign-workspace denial.
- Browser checks with isolated sample responses: add, refresh, second note, newest-first order, multiline display, draft retention across status changes, failed-save retention and retry, 1440/1024/390 widths and dark mode.
- Typecheck and production build pass. Lint passes with three pre-existing image/navigation warnings.
