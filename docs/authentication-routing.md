# Staff authentication routing

Production is https://www.northsidebrand.com. The bare northsidebrand.com domain redirects there. Keep authentication on that same host so the browser's PKCE verifier and session cookies remain available. The application uses relative post-login redirects and the browser's current origin for password recovery; no Vercel preview or old project hostname is hardcoded in the auth flow.

## Supabase URL configuration

For the production project, set:

- Site URL: `https://www.northsidebrand.com`
- Allowed redirect: `https://www.northsidebrand.com/auth/callback`
- Allowed redirect: `https://www.northsidebrand.com/reset-password`

Use the exact callback URL as `redirectTo` / `emailRedirectTo` when generating authentication links. Root callbacks remain supported for existing emails and providers that fall back to Site URL. Do not set Site URL to the obsolete `northside-hq.vercel.app` address. Development callback URLs belong in the separate testing project's configuration.

## Routes and security

- `/auth/callback` exchanges a PKCE code using the server Supabase client, preserves session cookies, verifies the current user, checks the existing approved-staff roster through `hub_context`, and evaluates the existing hard NDA gate.
- Root `/?code=...` requests are rewritten internally to the same callback endpoint before rendering. This is not a second authentication implementation.
- Accepted staff go to `/today`; staff with an outstanding NDA go to `/agreements/required`. Gate failures lead to the existing locked agreement screen. Inactive/unapproved/unverified users cannot enter HQ.
- Password sign-in goes through `/auth/complete`, using the same authorization and NDA routing without requiring a code or reading operational records.
- Missing, expired, reused, or invalid credentials produce a fixed sign-in message. Arbitrary `next` / `redirectTo` values are ignored. Callback responses remove credentials from the destination URL, use `no-store` and `no-referrer`, and never log provider error details.
- Verified email/invite token-hash links use the same endpoint. Recovery links that arrive at the callback retain the `/reset-password` destination; the existing direct password recovery flow is unchanged.
- No service-role keys, user recreation, schema changes, or NDA bypasses are required.

A PKCE link must be opened in the browser and on the host where it was requested. Already-used codes and links with a missing verifier require a fresh link; the callback must not bypass that security check.

## Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` cover the change. Auth routing tests use the installed Supabase SSR SDK and synthetic transport responses to exercise real PKCE cookie creation, code exchange, user verification, session reuse, and failure handling. Existing database agreement tests continue to verify the NDA protections independently.
