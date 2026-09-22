'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase-browser';
import { requestPasswordReset } from '@/lib/password-recovery';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || cooldown) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setMessage(await requestPasswordReset(browserClient().auth, email, window.location.origin));
      setCooldown(60);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'We could not send the reset email. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell"><section className="panel">
    <p className="brand-word">NORTHSIDE HQ</p>
    <h1>Forgot password?</h1>
    <p>Enter your team email and we’ll send you a link to set a new password.</p>
    <form onSubmit={submit} aria-busy={busy}>
      <label htmlFor="email">Email address</label>
      <input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
      {error && <p className="notice error auth-notice" role="alert">{error}</p>}
      {message && <div className="notice auth-notice" role="status"><p>{message}</p><p>Open the link in this browser. Use the most recent email if you request another link.</p></div>}
      <button disabled={busy || cooldown > 0}>{busy ? 'Sending…' : cooldown ? `Send again in ${cooldown}s` : message ? 'Send another link' : 'Send reset link'}</button>
    </form>
    <p className="auth-links"><Link href="/login" className="text-link">Back to sign in</Link></p>
  </section></main>;
}
