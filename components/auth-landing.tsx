'use client';

import {useEffect, useRef} from 'react';
import {useRouter} from 'next/navigation';
import {browserClient} from '@/lib/supabase-browser';
import {authLandingDestination} from '@/lib/auth-landing';

export function AuthLanding() {
  const router = useRouter();
  const pending = useRef<Promise<string> | null>(null);
  useEffect(() => {
    let active = true;
    pending.current ??= authLandingDestination(
      window.location.href,
      () => window.history.replaceState(null, '', '/'),
      () => browserClient(true).auth,
    );
    pending.current.then(destination => { if (active) router.replace(destination); });
    return () => { active = false; };
  }, [router]);
  return <main className="auth-shell"><section className="panel">
    <p className="brand-word">NORTHSIDE HQ</p>
    <p role="status">Opening Northside HQ…</p>
    <noscript>Enable JavaScript to finish signing in or reset your password.</noscript>
  </section></main>;
}
