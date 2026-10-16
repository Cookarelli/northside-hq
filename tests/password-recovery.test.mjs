import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { INVALID_RESET, RESET_CONFIRMATION, preparePasswordReset, requestPasswordReset, saveNewPassword } from '../lib/password-recovery.ts';

const origin = 'https://marketinghub-7vl1.vercel.app';
const user = { id: 'test-user', aud: 'authenticated', role: 'authenticated', email: 'staff@example.test', email_confirmed_at: '2026-09-18T00:00:00Z', created_at: '2026-09-18T00:00:00Z', app_metadata: {}, user_metadata: {} };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('real Supabase SDK: request email, restore PKCE in a fresh client, verify identity, update password and sign out', async () => {
  const values = new Map();
  const calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const payload = { sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
  const accessToken = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test-signature`;
  const transport = async (url, init) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: parsed.pathname, method: init.method, body, search: parsed.searchParams });
    if (parsed.pathname.endsWith('/recover')) return response({});
    if (parsed.pathname.endsWith('/token')) {
      assert.equal(parsed.searchParams.get('grant_type'), 'pkce');
      assert.equal(body.auth_code, 'synthetic-recovery-code');
      assert.ok(body.code_verifier.length > 20);
      return response({ access_token: accessToken, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user });
    }
    if (parsed.pathname.endsWith('/user')) return response(user);
    if (parsed.pathname.endsWith('/logout')) return response({});
    throw new Error(`Unexpected test request: ${parsed.pathname}`);
  };
  const makeClient = () => createClient('https://auth.example.test', 'synthetic-public-key', {
    auth: { flowType: 'pkce', detectSessionInUrl: false, autoRefreshToken: false, storage },
    global: { fetch: transport },
  });
  const first = makeClient();
  assert.equal(await requestPasswordReset(first.auth, ' staff@example.test ', origin), RESET_CONFIRMATION);
  const recover = calls.find(call => call.path.endsWith('/recover'));
  assert.equal(recover.body.email, 'staff@example.test');
  assert.equal(recover.search.get('redirect_to'), `${origin}/reset-password`);
  assert.equal(recover.body.code_challenge_method, 's256');
  assert.ok(recover.body.code_challenge);
  const second = makeClient();
  let cleaned = false;
  assert.equal(await preparePasswordReset(second.auth, `${origin}/reset-password?code=synthetic-recovery-code&next=https://untrusted.test`, () => { cleaned = true; }), user.email);
  assert.ok(cleaned);
  assert.match(await saveNewPassword(second.auth, 'New-test-password-123!', 'New-test-password-123!'), /updated/);
  const update = calls.find(call => call.path.endsWith('/user') && call.method === 'PUT');
  assert.equal(update.body.password, 'New-test-password-123!');
  assert.ok(calls.some(call => call.path.endsWith('/logout') && call.search.get('scope') === 'global'));
  assert.equal((await second.auth.getSession()).data.session, null);
});

test('expired or reused code never falls back to an existing session', async () => {
  let checked = false;
  const auth = {
    exchangeCodeForSession: async () => ({ error: { code: 'otp_expired' } }),
    getUser: async () => { checked = true; return { data: { user }, error: null }; },
  };
  await assert.rejects(preparePasswordReset(auth, `${origin}/reset-password?code=used`, () => {}), { message: INVALID_RESET });
  assert.equal(checked, false);
});

test('missing session, error callbacks, and incomplete or wrong-type tokens cannot reset a password', async () => {
  const auth = { getUser: async () => ({ data: { user: null }, error: null }) };
  for (const suffix of ['', '?error_code=otp_expired', '#error=access_denied', '?token_hash=invalid&type=signup', '#access_token=invalid&type=recovery']) {
    await assert.rejects(preparePasswordReset(auth, `${origin}/reset-password${suffix}`, () => {}), { message: INVALID_RESET });
  }
});

test('optional recovery token-hash and dashboard email fragment flows verify the authenticated user', async () => {
  const used = [];
  const auth = {
    verifyOtp: async input => { used.push(input.type); return { error: null }; },
    setSession: async input => { used.push(input.refresh_token); return { error: null }; },
    getUser: async () => ({ data: { user }, error: null }),
  };
  assert.equal(await preparePasswordReset(auth, `${origin}/reset-password?token_hash=synthetic&type=recovery`, () => {}), user.email);
  assert.equal(await preparePasswordReset(auth, `${origin}/reset-password#access_token=synthetic&refresh_token=test-refresh&type=recovery`, () => {}), user.email);
  assert.equal(await preparePasswordReset(auth, `${origin}/reset-password?token_hash=synthetic&type=invite`, () => {}), user.email);
  assert.equal(await preparePasswordReset(auth, `${origin}/reset-password#access_token=synthetic&refresh_token=invite-refresh&type=invite`, () => {}), user.email);
  assert.deepEqual(used, ['recovery', 'test-refresh', 'invite', 'invite-refresh']);
});

test('email rate limits and delivery failures are honest and do not expose provider detail', async () => {
  const limited = { resetPasswordForEmail: async () => ({ error: { status: 429, code: 'over_email_send_rate_limit' } }) };
  await assert.rejects(requestPasswordReset(limited, user.email, origin), /Too many reset requests/);
  const failed = { resetPasswordForEmail: async () => ({ error: { status: 500, message: 'private SMTP detail' } }) };
  await assert.rejects(requestPasswordReset(failed, user.email, origin), /could not send the reset email/);
  const absent = { resetPasswordForEmail: async () => ({ error: null }) };
  assert.equal(await requestPasswordReset(absent, 'unknown@example.test', origin), RESET_CONFIRMATION);
});

test('password confirmation and expired sessions are checked before any mutation', async () => {
  let mutations = 0;
  const auth = { getUser: async () => ({ data: { user: null }, error: null }), updateUser: async () => { mutations++; return { error: null }; } };
  await assert.rejects(saveNewPassword(auth, 'short', 'short'), /at least 8/);
  await assert.rejects(saveNewPassword(auth, 'long-password', 'different-password'), /do not match/);
  await assert.rejects(saveNewPassword(auth, 'long-password', 'long-password'), { message: INVALID_RESET });
  assert.equal(mutations, 0);
});

test('weak passwords stay errors; sign-out trouble after a successful update still reports the update accurately', async () => {
  const base = { getUser: async () => ({ data: { user }, error: null }), signOut: async () => { throw new Error('offline'); } };
  await assert.rejects(saveNewPassword({ ...base, updateUser: async () => ({ error: { code: 'weak_password' } }) }, 'test-password', 'test-password'), /account requirements/);
  assert.match(await saveNewPassword({ ...base, updateUser: async () => ({ error: null }) }, 'test-password', 'test-password'), /password has been updated.*sign out/);
});
