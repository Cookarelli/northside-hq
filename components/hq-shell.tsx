'use client';

import Link from 'next/link';
import Image from 'next/image';
import {usePathname} from 'next/navigation';
import {CalendarDays, FolderKanban, Images, Inbox, Sun} from 'lucide-react';
import {hqSections, sectionForPath} from '@/lib/hq-navigation';
import {HqNotifications} from '@/components/hq-notifications';
import {SignOut} from '@/components/sign-out';
import {ThemeToggle} from '@/components/theme-provider';

const icons = {today: Sun, projects: FolderKanban, calendar: CalendarDays, requests: Inbox, assets: Images};

export function HqShell({children}: {children: React.ReactNode}) {
  const pathname = usePathname();
  const active = sectionForPath(pathname);
  const section = hqSections.find(item => item.id === active)!;
  const research = pathname === '/assets/research';
  return <div className="hub hq-shell">
    <a className="skip-link" href="#hq-main">Skip to main content</a>
    <header className="masthead hq-masthead">
      <Link href="/today" className="hq-brand" aria-label="Northside HQ home">
        <Image src="/northside-collectibles-blue.svg" alt="Northside Collectibles" width={2070} height={572} unoptimized loading="eager" className="hq-logo"/>
      </Link>
      <div className="header-meta"><ThemeToggle/><HqNotifications/><SignOut/></div>
    </header>
    <div className="hq-frame">
      <nav className="hq-navigation" aria-label="Main navigation">{hqSections.map(item => {
        const Icon = icons[item.id];
        return <Link key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}><Icon size={22} aria-hidden="true"/><span>{item.label}</span></Link>;
      })}</nav>
      <main className="workspace hq-workspace" id="hq-main" tabIndex={-1}>
        <div className="hq-page-heading"><div><p className="eyebrow">NORTHSIDE HQ{research ? ' / ASSETS' : ''}</p><h1>{research ? 'Research & sources' : section.label}</h1><p className="muted">{research ? 'Collect stories, save ideas and keep the original sources close.' : section.description}</p></div><span className="hq-timezone">Central time<br/><strong>America/Chicago</strong></span></div>
        {children}
        <footer className="hub-footer"><span>Northside HQ · Northside Collectibles</span><span>Publishing is manual · Updates stay in the app</span></footer>
      </main>
    </div>
  </div>;
}
