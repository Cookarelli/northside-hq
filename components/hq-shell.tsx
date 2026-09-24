'use client';

import Link from 'next/link';
import {useState} from 'react';
import {HqPageActionsContext} from '@/components/hq-page-actions';
import Image from 'next/image';
import {usePathname, useSearchParams} from 'next/navigation';
import {CalendarDays, FolderKanban, Images, Inbox, Sun, ListChecks, Settings} from 'lucide-react';
import {hqSections, sectionForPath} from '@/lib/hq-navigation';
import {STORE_OPEN_CHECKLIST,STORE_OPENING_DATE_LABEL,STORE_OPENING_TIME_LABEL} from '@/lib/store-opening';
import {useActiveNavigation} from '@/components/hq-subnavigation';
import {HqNotifications} from '@/components/hq-notifications';
import {SignOut} from '@/components/sign-out';
import {ThemeToggle} from '@/components/theme-provider';

const icons = {today: Sun, projects: FolderKanban, calendar: CalendarDays, assignments: ListChecks, requests: Inbox, assets: Images, operations: Settings};

export function HqShell({children}: {children: React.ReactNode}) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const active = sectionForPath(pathname);
  const navigation=useActiveNavigation(active);
  const section = hqSections.find(item => item.id === active)!;
  const research = pathname === '/assets/research';
  const tab = useSearchParams().get('tab');
  const checklist = pathname === '/projects' && (tab === 'store-open-checklist' || tab === 'launch');
  const jon = pathname === '/assets' && tab === 'jons-content';
  const record = pathname.startsWith('/projects/') || pathname.startsWith('/requests/');
  const title = checklist ? STORE_OPEN_CHECKLIST : jon ? 'Jon’s Content' : research ? 'Research & sources' : section.label;
  const description = checklist ? `Opening ${STORE_OPENING_DATE_LABEL} at ${STORE_OPENING_TIME_LABEL}` : jon ? 'Upload content, then assign it to a project or deliverable.' : research ? 'Collect stories, save ideas and keep the original sources close.' : section.description;
  return <HqPageActionsContext.Provider value={actions}><div className="hub hq-shell">
    <a className="skip-link" href="#hq-main">Skip to main content</a>
    <header className="masthead hq-masthead">
      <Link href="/today" className="hq-brand" aria-label="Northside HQ home">
        <Image src="/northside-collectibles-blue.svg" alt="Northside Collectibles" width={2070} height={572} unoptimized loading="eager" className="hq-logo"/>
      </Link>
      <div className="header-meta"><ThemeToggle/><HqNotifications/><SignOut/></div>
    </header>
    <div className="hq-frame">
      <nav ref={navigation} className="hq-navigation" aria-label="Main navigation">{hqSections.map(item=>{const Icon=icons[item.id];return <Link key={item.id} href={item.href} aria-current={active===item.id?'page':undefined}><Icon size={21} aria-hidden="true"/><span>{item.label}</span></Link>;})}</nav>
      <main className="workspace hq-workspace" id="hq-main" tabIndex={-1}>
        {!record && <header className="hq-page-heading"><div>{(checklist || jon || research) && <p className="hq-meta">{section.label}</p>}<h1>{title}</h1><p className="muted">{description}</p></div><div ref={setActions} className="hq-page-actions"/></header>}
        {children}
        <footer className="hub-footer"><span>Northside HQ · Northside Collectibles</span><span>Publishing is manual · Updates stay in the app</span></footer>
      </main>
    </div>
  </div></HqPageActionsContext.Provider>;
}
