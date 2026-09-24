'use client';

import Link from 'next/link';
import {useState} from 'react';
import {HqPageActionsContext} from '@/components/hq-page-actions';
import Image from 'next/image';
import {usePathname, useSearchParams} from 'next/navigation';
import {CalendarDays, FolderKanban, Images, Sun, Settings} from 'lucide-react';
import {hqSections, hqSettings, sectionForPath} from '@/lib/hq-navigation';
import {STORE_OPEN_CHECKLIST,STORE_OPENING_DATE_LABEL,STORE_OPENING_TIME_LABEL} from '@/lib/store-opening';
import {useActiveNavigation} from '@/components/hq-subnavigation';
import {HqNotifications} from '@/components/hq-notifications';
import {SignOut} from '@/components/sign-out';
import {ThemeToggle} from '@/components/theme-provider';

const icons = {today: Sun, projects: FolderKanban, calendar: CalendarDays, assets: Images};

export function HqShell({children}: {children: React.ReactNode}) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const active = sectionForPath(pathname);
  const navigation=useActiveNavigation(active);
  const section = active==='settings'?hqSettings:hqSections.find(item => item.id === active)!;
  const requests = pathname === '/requests';
  const research = pathname === '/assets/research';
  const tab = useSearchParams().get('tab');
  const checklist = pathname === '/projects' && (tab === 'store-open-checklist' || tab === 'launch');
  const jon = pathname === '/assets' && tab === 'jons-content';
  const record = pathname.startsWith('/projects/') || pathname.startsWith('/requests/');
  const title = checklist ? STORE_OPEN_CHECKLIST : jon ? 'Jon’s Content' : research ? 'Research & sources' : requests ? 'Requests' : section.label;
  const description = checklist ? `Opening ${STORE_OPENING_DATE_LABEL} at ${STORE_OPENING_TIME_LABEL}` : jon ? 'Upload content, then assign it to a project or deliverable.' : research ? 'Collect stories, save ideas and keep the original sources close.' : requests ? 'Ask for work, track decisions and open editorial review.' : section.description;
  return <HqPageActionsContext.Provider value={actions}><div className="hub hq-shell">
    <a className="skip-link" href="#hq-main">Skip to main content</a>
    <header className="masthead hq-masthead">
      <Link href="/today" className="hq-brand" aria-label="Northside HQ home">
        <Image src="/northside-collectibles-blue.svg" alt="Northside Collectibles" width={2070} height={572} unoptimized loading="eager" className="hq-logo"/>
      </Link>
      <div className="header-meta"><ThemeToggle/><HqNotifications/><Link className="hq-settings-link" href="/settings" aria-current={active==='settings'?'page':undefined}><Settings size={18} aria-hidden="true"/>Settings</Link><SignOut/></div>
    </header>
    <div className="hq-frame">
      <nav ref={navigation} className="hq-navigation" aria-label="Main navigation">{hqSections.map(item=>{const Icon=icons[item.id];return <Link key={item.id} href={item.href} aria-current={active===item.id?'page':undefined}><Icon size={21} aria-hidden="true"/><span>{item.label}</span></Link>;})}</nav>
      <main className="workspace hq-workspace" id="hq-main" tabIndex={-1}>
        {requests&&<Link className="hq-breadcrumb" href="/today">← Home</Link>}
        {!record && <header className="hq-page-heading"><div>{(checklist || jon || research) && <p className="hq-meta">{section.label}</p>}<h1>{title}</h1><p className="muted">{description}</p></div><div ref={setActions} className="hq-page-actions">{pathname==='/today'&&<Link className="hq-home-requests" href="/requests">Requests →</Link>}</div></header>}
        {children}
        <footer className="hub-footer"><span>Northside HQ · Northside Collectibles</span><span>Publishing is manual · Updates stay in the app</span></footer>
      </main>
    </div>
  </div></HqPageActionsContext.Provider>;
}
