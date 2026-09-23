import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgreementGate } from './agreements';

export const HQ_HOME = '/today';
export const AUTH_ERRORS = {
  'invalid-link': 'This sign-in link is invalid, expired, or already used. Request a new link and open it in the same browser where you requested it, or sign in with your password.',
  'access-denied': 'This account does not have access to Northside HQ. Contact Steven.',
  'unavailable': 'Sign-in could not be completed. Please try again. Your workspace remains protected.',
} as const;

export function authErrorMessage(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(AUTH_ERRORS, value)
    ? AUTH_ERRORS[value as keyof typeof AUTH_ERRORS] : '';
}

// Root callbacks are rewritten internally to the dedicated handler. Only auth
// parameters survive; caller-provided destinations never control a redirect.
export function legacyAuthCallback(search: URLSearchParams) {
  if (!['code', 'token_hash', 'error', 'error_code'].some(key => search.has(key))) return null;
  const callback = new URLSearchParams();
  for (const key of ['code', 'sb_flow_id', 'token_hash', 'type', 'error', 'error_code']) {
    for (const value of search.getAll(key)) callback.append(key, value);
  }
  return `/auth/callback?${callback}`;
}

type CheckAgreement = () => Promise<AgreementGate>;

export async function postLoginDestination(client: SupabaseClient, checkAgreement: CheckAgreement) {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user?.email_confirmed_at) return '/login?auth=invalid-link';
  const { data: staff, error: accessError } = await client.rpc('hub_context');
  if (accessError) return '/login?auth=unavailable';
  if (!staff?.orgId || staff.userId !== user.id) return '/login?auth=access-denied';
  try {
    const gate = await checkAgreement();
    // The existing agreement helper validates the hard gate and fails closed.
    return gate.required ? '/agreements/required' : HQ_HOME;
  } catch {
    // The agreement screen displays the existing locked/unavailable state.
    return '/agreements/required';
  }
}

export async function authCallbackDestination(client: SupabaseClient, search: URLSearchParams, checkAgreement: CheckAgreement) {
  const invalid = '/login?auth=invalid-link';
  if (search.has('error') || search.has('error_code')) return invalid;
  for (const key of ['code', 'sb_flow_id', 'token_hash', 'type']) {
    if (search.getAll(key).length > 1) return invalid;
  }
  const code = search.get('code');
  const tokenHash = search.get('token_hash');
  let recovery = false;
  if (code && !tokenHash && code.length <= 2048) {
    const flowId = search.get('sb_flow_id');
    const { data, error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    // Never fall back to an older signed-in session after a failed exchange.
    if (error || !data.session) return invalid;
    recovery = 'redirectType' in data && data.redirectType === 'recovery';
  } else if (tokenHash && !code && tokenHash.length <= 2048) {
    const type = search.get('type');
    if (type !== 'email' && type !== 'signup' && type !== 'invite' && type !== 'email_change' && type !== 'recovery') return invalid;
    const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error || !data.session) return invalid;
    recovery = type === 'recovery';
  } else {
    return invalid;
  }
  if (recovery) {
    const { data: { user }, error } = await client.auth.getUser();
    return !error && user?.email_confirmed_at ? '/reset-password' : invalid;
  }
  return postLoginDestination(client, checkAgreement);
}
