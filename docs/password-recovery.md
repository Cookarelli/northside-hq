# Password recovery

The login page links to `/forgot-password`. Supabase sends the recovery email; the app never creates a new account or uses an administrator key. After a valid recovery link, `/reset-password` verifies the user with Supabase, accepts a new password and confirmation, updates that user's password, and requests global sign-out. Existing staff membership and database access checks remain unchanged.

## Supabase setup

In the existing production project `yogdhpfattuxicwyxylb`, under **Authentication → URL Configuration**:

- Site URL: `https://marketinghub-7vl1.vercel.app`
- Add the exact redirect URL: `https://marketinghub-7vl1.vercel.app/reset-password`
- Keep existing required redirect URLs. Do not add a broad production wildcard.\n- For local testing, also allow `http://localhost:3000/reset-password`.\n- Confirm the Vercel Production environment has `NEXT_PUBLIC_SUPABASE_URL=https://yogdhpfattuxicwyxylb.supabase.co` and the matching publishable key.

The default **Reset Password** email template can keep its `{{ .ConfirmationURL }}` link. The app uses PKCE; request and open the email link in the same browser. For a deliberately customized token-hash template, the supported link is `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`. Do not change other email templates for this feature.

The reset page also supports a recovery fragment from a dashboard-generated default email, if it is sent to this page. Tokens are removed from the address bar, never logged, and checked by Supabase before a password update. A failed link does not fall back to an existing signed-in account. A signed-in user may also visit `/reset-password` to change their own password; Supabase's configured password policies still apply.

Email delivery requires working Supabase Auth SMTP configuration. The built-in sender has strict limits and recipient restrictions. Configure the existing approved SMTP service if needed. An email rate limit is displayed as an error, never as a successful send. Unknown email addresses receive the same neutral confirmation as existing addresses. Supabase's server-side limits remain authoritative; the interface also provides a 60-second resend cooldown.

## Verification

`tests/password-recovery.test.mjs` uses the installed Supabase SDK against a synthetic HTTP transport to exercise request → PKCE exchange in a fresh client → verified user → password update → global sign-out. Additional cases cover expired/used links, missing sessions, provider callback errors, token-hash and implicit recovery, email throttling, password mismatch/strength, and sign-out failure after a successful update. No test sends email or changes a real password.

Before calling production recovery fully verified, confirm the exact redirect configuration, send a reset to an existing approved user, open the latest email in the requesting browser, set a new password, and sign in to the workspace. The account owner must enter the new password. If the email goes to localhost or the login page, fix URL Configuration and request a fresh link. If SMTP fails or email limits are exceeded, resolve delivery rather than weakening account protection.
