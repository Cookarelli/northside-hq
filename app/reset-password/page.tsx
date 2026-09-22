'use client';

import Link from 'next/link';
import {PasswordField} from '@/components/password-field';
import { useEffect, useRef, useState } from 'react';
import { browserClient } from '@/lib/supabase-browser';
import { INVALID_RESET, preparePasswordReset, saveNewPassword } from '@/lib/password-recovery';

export default function ResetPassword() {
  const pending = useRef<Promise<string | undefined> | null>(null);
  const client = useRef<ReturnType<typeof browserClient> | null>(null);
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    // Reuse the promise during React's development effect replay so a single-use
    // code is exchanged once. The client uses the existing PKCE cookie storage.
    pending.current ??= Promise.resolve().then(() => {
      const href = window.location.href;
      client.current = browserClient(true);
      return preparePasswordReset(client.current.auth, href, () => {
        window.history.replaceState(null, '', '/reset-password');
      });
    });
    pending.current.then(value => {
      if (active) { setEmail(value || ''); setState('ready'); }
    }).catch(() => {
      if (active) { setError(INVALID_RESET); setState('invalid'); }
    });
    return () => { active = false; };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !client.current || state !== 'ready') return;
    setBusy(true);
    setError('');
    try {
      setMessage(await saveNewPassword(client.current.auth, password, confirmation));
      setPassword('');
      setConfirmation('');
      setState('done');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Your password could not be updated.';
      setError(message);
      if (message === INVALID_RESET) setState('invalid');
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell"><section className="panel">
    <p className="brand-word">NORTHSIDE HQ</p>
    <h1>{state === 'done' ? 'Password updated' : 'Set a new password'}</h1>
    {state === 'checking' && <p role="status">Checking your reset link…</p>}
    {error && <p className="notice error auth-notice" role="alert">{error}</p>}
    {state === 'ready' && <>
      <p>Choose a new password for {email || 'your team account'}.</p>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor="password">New password</label>
        <PasswordField id="password" autoComplete="new-password" minLength={8} required aria-describedby="password-help" value={password} onChange={event => setPassword(event.target.value)} />
        <p id="password-help" className="muted">Use at least 8 characters. A longer, unique password is best.</p>
        <label htmlFor="confirm-password">Confirm new password</label>
        <PasswordField id="confirm-password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
        <button disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      </form>
    </>}
    {state === 'done' && <p className="notice auth-notice" role="status">{message}</p>}
    {state === 'invalid' && <p className="auth-links"><Link href="/forgot-password" className="text-link">Request a new reset link</Link></p>}
    <p className="auth-links"><Link href="/login" className="text-link">Back to sign in</Link></p>
  </section></main>;
}
