# Meta integration prerequisites — October 20, 2026

## Current status

This is an audit and preparation checklist. Production `main` has manual publication confirmations and manual metrics. This PR adds no Meta transport, OAuth flow, token store, worker, cron job or permission grant. No Meta account credentials were requested or read. Actual Page ownership, linked Instagram identity, app status, granted permissions, token validity, account limits and production insights access remain unverified.

The separate preview branch at `1ee54cad934622df885ed0cd7fecfe0a3d7567da` contains Meta OAuth, history/insights and encrypted credentials. Inspection of `lib/meta/core.ts` shows proposed read scopes `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`, and a v26.0 configuration pin. `lib/meta/publishing.ts` hard-stops `publish()` with `live_publishing_disabled`. Those files are not merged into this PR or production. Preserve their hard stop if that proposal is subsequently integrated. Its configuration and hosted acceptance tests require their own review.

## Account and access evidence to collect before integration

| Evidence | Required review |
| --- | --- |
| Correct business identities | Record the actual Facebook Page ID and Instagram professional account ID in server configuration; verify who manages them. For the Facebook Login path, confirm the Page is linked to the professional Instagram account. Consumer Instagram accounts are ineligible. |
| Instagram Stories eligibility | Verify a Business account for API Story publishing. The Facebook Login collection distinguishes Business-only Stories from other professional publishing. Keep the requested native repost workflow manual until its exact API equivalent is confirmed. |
| Login path | Choose Facebook Login when integrating the existing proposed Page-based flow. Instagram Login is a different integration and permission namespace; do not mix `instagram_business_*` scopes into that Facebook flow. |
| Account tasks | Confirm the Page access token and the user's relevant Page tasks from account discovery; distinguish content creation from analytics access. |

These distinctions are supported by Meta's [Facebook Login collection](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login), [Instagram Login collection](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login), and [Page token discovery example](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-da5fcc4c-0d08-40cf-a550-e79d0c9955e2). They do not establish that Northside has completed the prerequisites.

## Permission and review gates

Review the exact current permission requirements against the intended Graph version and App Dashboard before consent. For the proposed Facebook Login integration, audit read access separately from future write access:

- Discovery and reads: proposed `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic` and `instagram_manage_insights`. Verify token type, Page ANALYZE access, supported account/media metrics and each required grant with actual read-only calls in staging.
- Future publishing: separately review `pages_manage_posts` for Facebook and `instagram_content_publish` for the Page-linked Instagram path, together with required base/read permissions. The official Instagram collection includes the latter in its publishing permissions. No write scope is requested by this change.
- Verify whether the app needs Standard or Advanced Access for the real business/user relationship. Confirm App Review and any required business verification, app mode, eligible test users, privacy policy, data deletion callback/instructions, retention policy, redirect allowlist and reviewer demonstration. Completion must be evidenced in the real App Dashboard.

Direct Meta developer reference pages returned HTTP 429 during this audit. Current Facebook-specific scope combinations, insights permission/metric details and App Review decisions are therefore open verification gates, not certified readiness. References for the reviewer: [Pages API setup](https://developers.facebook.com/docs/pages-api/getting-started/), [Pages posts](https://developers.facebook.com/docs/pages-api/posts/), [permission reference](https://developers.facebook.com/docs/permissions/), [Instagram insights](https://developers.facebook.com/documentation/instagram-platform/insights), [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review).

## Engineering prerequisites for a future approved implementation

Keep app secrets, encryption keys, user/Page tokens and worker credentials server-side in the approved secret manager. Store encrypted credentials outside browser-readable schemas; use org/account-bound encryption, restricted RPCs, expiring single-use OAuth state and exact HTTPS redirects. Redact OAuth query strings, cookies and Authorization headers from logs. Document rotation, expiry, revocation, reconnect, disconnect and deletion behavior. Do not place secrets in source, URLs shown to users, screenshots or `NEXT_PUBLIC_*` variables.

Verify each media surface separately: Facebook feed/photos/reels/Stories and Instagram image/carousel/reel/Story. A native feed-to-Story repost is not established merely by supporting a new Story upload. Confirm carousel resharing, links/stickers, account eligibility, media rights and provider limits before representing them as automated capabilities. Meta's [Reels collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-da5fcc4c-0d08-40cf-a550-e79d0c9955e2) illustrates separate media-container creation, processing-status checks and publication; it requires provider-fetchable media. The existing private bucket must not become public to satisfy that requirement. Design narrowly scoped temporary media access only after approval.

Bind every future publication to the exact approved HQ content version, owner/publisher, platform and account. Require idempotency, duplicate checks, durable provider receipts, rate-limit handling and reconciliation after uncertain outcomes; do not retry an uncertain write blindly. Insights should retain provider ID, platform/surface, metric name/definition, period, observation time and unavailable reasons. Never sum overlapping cumulative snapshots or turn unavailable metrics into zeros. Validate metrics against the chosen version rather than assuming old reach/impression fields still apply.

The dashboard delivered here keeps these boundaries manual: it records confirmed feed and Story facts and appends staff-observed metric snapshots. It cannot publish externally. A separate explicit production approval is required before any live integration or automation is enabled.
