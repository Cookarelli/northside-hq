'use client';

import {useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {BarChart3, CalendarDays, CheckSquare2, FileText, FolderKanban, Images, LayoutDashboard, Menu, Settings2, Users, Plus} from 'lucide-react';
import {hqSections, pageForPath, sectionForPath} from '@/lib/hq-navigation';
import {HqNotifications} from '@/components/hq-notifications';
import {SignOut} from '@/components/sign-out';
import {ThemeToggle} from '@/components/theme-provider';
import {PageHeader} from '@/components/hq-ui';
import {Button} from '@/components/ui/button';
import {Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger} from '@/components/ui/sheet';

const icons = {overview: LayoutDashboard, work: CheckSquare2, calendar: CalendarDays, campaigns: FolderKanban, content: FileText, results: BarChart3, assets: Images, team: Users, settings: Settings2};

function Brand() {
  return <Link href="/today" className="hq-brand" aria-label="Northside HQ home"><span className="hq-brand-mark" aria-hidden="true">N<span>•</span></span><span><strong>Northside HQ</strong><small>Northside Collectibles</small></span></Link>;
}

function Navigation({onNavigate}: {onNavigate?: () => void}) {
  const active = sectionForPath(usePathname());
  return <nav className="hq-navigation" aria-label="Main navigation">{(['primary', 'secondary'] as const).map(group => <div key={group} className={`hq-nav-${group}`}>
    <p className="hq-nav-label">{group === 'primary' ? 'Workspace' : 'Manage'}</p>
    {hqSections.filter(item => item.group === group).map(item => {
      const Icon = icons[item.id];
      return <Link key={item.id} href={item.href} onClick={onNavigate} aria-current={active === item.id ? 'page' : undefined}><Icon size={19} aria-hidden="true"/><span>{item.label}</span></Link>;
    })}
  </div>)}</nav>;
}

export function HqShell({children}: {children: React.ReactNode}) {
  const pathname = usePathname();
  const page = pageForPath(pathname);
  const [open, setOpen] = useState(false);
  return <div className="hub hq-shell">
    <a className="skip-link" href="#hq-main">Skip to main content</a>
    <aside className="hq-sidebar"><Brand/><p className="hq-command-label">Operations Command Center</p><Navigation/><div className="hq-sidebar-footer"><span className="hq-workspace-dot" aria-hidden="true"/>Internal workspace</div></aside>
    <div className="hq-main-frame">
      <header className="hq-topbar">
        <div className="hq-topbar-location"><div className="hq-mobile-nav"><Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button variant="ghost" aria-label="Open navigation"><Menu size={20}/>Menu</Button></SheetTrigger><SheetContent side="left" className="hq-nav-drawer"><SheetTitle className="sr-only">Northside HQ navigation</SheetTitle><SheetDescription className="sr-only">Choose a workspace page.</SheetDescription><Brand/><p className="hq-command-label">Operations Command Center</p><Navigation onNavigate={() => setOpen(false)}/></SheetContent></Sheet></div><span className="hq-desktop-location">Northside HQ <span aria-hidden="true">/</span> <strong>{page.label}</strong></span><span className="hq-mobile-location">Northside HQ</span></div>
        <div className="hq-utilities"><span className="hq-timezone">Central time</span><ThemeToggle/><HqNotifications/><SignOut/></div>
      </header>
      <main className="hq-main" id="hq-main" tabIndex={-1}>
        {page.id !== 'overview' && <PageHeader title={page.title} description={page.description} breadcrumb={page.breadcrumb} primaryAction={pathname==='/work'||pathname==='/projects'||pathname==='/calendar'||pathname==='/content'||pathname==='/results'?<Button asChild><Link onClick={e=>{const url=new URL(e.currentTarget.href);if(url.pathname===pathname){e.preventDefault();history.replaceState(null,'',url.pathname+url.hash);window.dispatchEvent(new Event('hashchange'));}}} href={pathname==='/work'?'/work#new-task':pathname==='/projects'?'/projects#new-campaign':pathname==='/calendar'?'/work#new-task':pathname==='/content'?'/content#upload-source':'/results#add-results'}><Plus size={16}/>{pathname==='/projects'?'New Campaign':pathname==='/content'?'Upload Source':pathname==='/results'?'Add Results':'Add Task'}</Link></Button>:undefined}/>}
        {children}
        <footer className="hub-footer"><span>Northside HQ · Northside Collectibles</span><span>Operations Command Center</span></footer>
      </main>
    </div>
  </div>;
}
