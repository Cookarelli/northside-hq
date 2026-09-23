# Northside HQ production-readiness review — September 23, 2026

Status: NEEDS ATTENTION before the reviewed version can be called production-ready.

## Ready
- Production data reviewed read-only: 2 projects, 3 deliverables, 19 calendar posts, 1 request; all preserved.
- Eight verified accounts match approved staff. No obvious fake users or test/demo project titles found. Existing drafts were retained.
- No duplicate project/calendar records by title/date or duplicate notification event keys found. Separate Facebook/Instagram publication entries are intentional.
- Existing owner colors and staff identity mappings remain intact; contrast and owner mapping tests pass.
- Authentication, permissions, and NDA regression tests pass. The active production agreement file exists. Signed agreements remain untouched.
- Live unauthenticated Home, Projects, Calendar, and NDA routes redirect to sign-in. Protected records, HQ, and notification APIs reject unauthenticated requests.
- No shipped debug logging, fixture controls, or blocking TODOs found. Two sanitized server error logs intentionally remain for failure diagnosis.
- Loading, error/retry states, and internal navigation reviewed. Linked logo and renderer files return successfully.
- Lint passes with four existing warnings; typecheck, 96 tests, and production build pass.

## Fixed in the review branch
- My Assignments participates in session refresh and private cache rules.
- Fifteen existing Topps release records contain noon as a placeholder because no release time was supplied. Calendar, schedule, and CSV now identify these as date-only instead of claiming noon; records were not changed.
- Legacy offset-bearing project/deliverable dates convert to America/Chicago for editing and calendar display. Calendar date boundaries and overdue calculations honor the recorded instant.
- Research dates use America/Chicago instead of UTC; invalid dates show a safe fallback.

## Needs attention
- Draft PR #8 is not deployed. The live /assignments route currently returns 404. Deploy and smoke-test the reviewed branch before using its new workflow in production.
- This final browser recheck was blocked by Chrome's extension UI; native inspection also returned a blank screenshot. The previous full workflow audit passed at 390/768/1280/1440px, but the latest fixes did not receive a fresh mobile visual check.
- Reminders run in-app while HQ is open. Background/email reminders are not configured; do not rely on them.
- Unannounced Topps release times remain unknown. No guessed dates, draft work, staff identities, or other uncertain data were deleted.

No schema changes or migration commands are required for this review.
