import {redirect} from 'next/navigation';
import {configured} from '@/lib/supabase';
import {identity} from '@/lib/storage';
import {HqShell} from '@/components/hq-shell';
import {ThemeToggle} from '@/components/theme-provider';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({children}: {children: React.ReactNode}) {
  if (!configured()) return <><div className="appearance-bar"><ThemeToggle/></div><main className="auth-shell"><section className="panel"><p className="brand-word">NORTHSIDE HQ</p><h1>Team workspace setup</h1><p>Connect team sign in and shared storage to open Northside HQ.</p><p className="muted">The deployment guide lists the setup steps. Private records remain unavailable until configuration is complete.</p></section></main></>;
  try {await identity();} catch {redirect('/login');}
  return <HqShell>{children}</HqShell>;
}
