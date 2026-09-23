import type { SupabaseClient } from '@supabase/supabase-js';

type Auth = SupabaseClient['auth'];
export const RESET_CONFIRMATION = 'If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.';
export const INVALID_RESET = 'This reset link is invalid or has expired. Request a new link and open it in the same browser where you requested it.';

export function recoveryError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  const status = error && typeof error === 'object' && 'status' in error ? error.status : 0;
  if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return 'Too many reset requests. Wait a few minutes before trying again. If this continues, contact your workspace administrator.';
  }
  return 'We could not send the reset email. Please try again. If this continues, contact your workspace administrator.';
}

export async function requestPasswordReset(auth: Pick<Auth, 'resetPasswordForEmail'>, email: string, origin: string) {
  const { error } = await auth.resetPasswordForEmail(email.trim(), {
    redirectTo: new URL('/reset-password', origin).href,
  });
  if (error) throw new Error(recoveryError(error));
  return RESET_CONFIRMATION;
}

// Capture recovery credentials before exchanging them and remove them from the
// address bar immediately. Never log these values or accept a caller's redirect.
export async function preparePasswordReset(
  auth: Pick<Auth, 'exchangeCodeForSession' | 'setSession' | 'verifyOtp' | 'getUser'>,
  href: string,
  clearLocation: () => void,
) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  clearLocation();
  if (url.searchParams.has('error') || url.searchParams.has('error_code') || hash.has('error') || hash.has('error_code')) {
    throw new Error(INVALID_RESET);
  }
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const accessToken = hash.get('access_token');
  let result;
  if (code) {
    const flowId = url.searchParams.get('sb_flow_id');
    result = await auth.exchangeCodeForSession(code, flowId ? {flowId} : undefined);
  } else if (tokenHash && url.searchParams.get('type') === 'recovery') {
    result = await auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  } else if (accessToken && hash.get('refresh_token') && hash.get('type') === 'recovery') {
    result = await auth.setSession({ access_token: accessToken, refresh_token: hash.get('refresh_token')! });
  } else if (url.search || url.hash) {
    throw new Error(INVALID_RESET);
  }
  // A failed link must never fall back to a previously signed-in account.
  if (result?.error) throw new Error(INVALID_RESET);
  const { data, error } = await auth.getUser();
  if (error || !data.user || !data.user.email_confirmed_at) throw new Error(INVALID_RESET);
  return data.user.email;
}

export function passwordValidation(password: string, confirmation: string) {
  if (password.length < 8) return 'Use at least 8 characters for your new password.';
  if (password !== confirmation) return 'The passwords do not match.';
  return null;
}

export async function saveNewPassword(auth: Pick<Auth, 'getUser' | 'updateUser' | 'signOut'>, password: string, confirmation: string) {
  const invalid = passwordValidation(password, confirmation);
  if (invalid) throw new Error(invalid);
  const { data, error: sessionError } = await auth.getUser();
  if (sessionError || !data.user || !data.user.email_confirmed_at) throw new Error(INVALID_RESET);
  const { error } = await auth.updateUser({ password });
  if (error) {
    if (error.code === 'same_password') throw new Error('Choose a password different from your current password.');
    if (error.code === 'weak_password') throw new Error('That password does not meet the account requirements. Try a longer password with uppercase and lowercase letters, numbers, and symbols.');
    if (error.status === 401 || error.status === 403 || error.code === 'session_not_found') throw new Error(INVALID_RESET);
    throw new Error('Your password could not be updated. Try again or request a new reset link.');
  }
  // Once the password is changed, do not report a second failure as if it was not.
  try {
    const { error: signOutError } = await auth.signOut({ scope: 'global' });
    if (!signOutError) return 'Your password has been updated. Sign in with your new password.';
  } catch { /* The password update has already succeeded. */ }
  return 'Your password has been updated. Please sign out of any open sessions and sign in with your new password.';
}
