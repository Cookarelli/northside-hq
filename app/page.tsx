import Hub from './hub';
import {configured} from '@/lib/supabase';
import {identity} from '@/lib/storage';
import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page() {
  if (!configured()) return <main className="auth-shell"><section className="panel"><p className="brand-word">NORTHSIDE</p><h1>Team workspace setup</h1><p>Connect team sign in and shared storage to open this workspace.</p><p className="muted">The deployment guide lists the setup steps. Private records remain unavailable until configuration is complete.</p></section></main>;
  try { await identity(); } catch { redirect('/login'); }
  return <Hub />;
}
