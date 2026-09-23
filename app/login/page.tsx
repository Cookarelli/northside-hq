'use client';
import {useState} from 'react';
import Link from 'next/link';
import {PasswordField} from '@/components/password-field';
import {browserClient} from '@/lib/supabase-browser';
export default function Login() {
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent) {
    e.preventDefault();setError('');setBusy(true);
    try {
      const client=browserClient();
      const result=await client.auth.signInWithPassword({email:email.trim(),password});
      if (result.error) throw new Error('Sign in failed. Check your email and password.');
      const check=await fetch('/api/records');
      if (!check.ok) {await client.auth.signOut();throw new Error('This account could not open the Northside workspace. Contact Steven.');}
      window.location.assign('/today');
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <main className="auth-shell"><section className="panel"><p className="brand-word">NORTHSIDE HQ</p><h1>Welcome back</h1><p>Sign in to the shared team workspace.</p><form onSubmit={submit}><label htmlFor="email">Email address</label><input id="email" autoComplete="username" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/><label htmlFor="password">Password</label><PasswordField id="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/>{error&&<p role="alert">{error}</p>}<button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><p className="auth-links"><Link href="/forgot-password" className="text-link">Forgot password?</Link></p><p className="muted">Need access? Contact Steven.</p></section></main>;
}
