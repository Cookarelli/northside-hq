'use client';
import Link from 'next/link';
import {HqSubnavigation,useHqTab} from '@/components/hq-subnavigation';
const homeTabs=[{id:'my-work',label:'My work'},{id:'schedule',label:'Schedule'},{id:'projects',label:'Active projects'},{id:'activity',label:'Recent activity'}];
import {Button} from '@/components/ui/button';
import {actionable,addDays,personName} from '@/lib/hq-operations';
import {type Deliverable,type HqRecord,type Project} from '@/lib/hq-model';
import {type CalendarPost} from '@/lib/content-calendar';
import {chicagoWall,type CampaignRecord} from '@/lib/consignment';
import {useHqClock} from '@/components/use-hq-clock';
import {useHqContext} from '@/components/use-hq-context';
import {HqCalendar} from '@/components/hq-calendar';
import {HqProjectCard} from '@/components/hq-project-card';
import {MyAssignments} from '@/components/my-assignments';
import {HqWorkItem} from '@/components/hq-work-item';
import {HqRecentActivity} from '@/components/hq-recent-activity';
export function HqToday({records,projects,posts,campaigns=[],loading,failed}:{records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];posts:CalendarPost[];campaigns?:CampaignRecord[];loading:boolean;failed:boolean}) {
 const tab=useHqTab(homeTabs,'my-work');
 const {context,error,reload}=useHqContext(),now=useHqClock();
 if(failed)return <p className="panel" role="alert">Dashboard is unavailable. Retry loading the saved workspace above.</p>;
 if(error)return <div className="panel" role="alert">{error}<Button onClick={reload}>Retry dashboard</Button></div>;
 if(loading||!context||now===null)return <p role="status">Loading dashboard…</p>;
 const name=(id:string)=>personName(id,context.staff),day=chicagoWall(now).slice(0,10);
 const upcoming=records.filter(r=>actionable(r.data,projects.find(p=>p.id===r.data.projectId)?.data)&&r.data.productionDue&&r.data.productionDue.slice(0,10)<=addDays(day,7)).sort((a,b)=>a.data.productionDue.localeCompare(b.data.productionDue));
 const active=projects.filter(p=>p.data.status==='active');
 return <div className="hq-dashboard"><HqSubnavigation tabs={homeTabs} active={tab} label="Home areas"/>{tab==='schedule'&&<HqCalendar records={records} projects={projects} posts={posts} campaigns={campaigns} staff={context.staff}/>}
 {tab==='my-work'&&<MyAssignments records={records} projects={projects} context={context} now={now} compact/>}
 {tab==='projects'&&<section><div className="section-title"><h2>Active Projects</h2><Link href="/projects">All projects →</Link></div><div className="hq-project-grid">{active.slice(0,6).map(p=><HqProjectCard key={p.id} project={p} deliverables={records} name={name} now={now}/>)}</div>{!active.length&&<div className="panel hq-empty"><h3>No active projects yet.</h3><p>Start with a project, then assign staff and schedule the work.</p><Link href="/projects?create=project">Create a project →</Link></div>}</section>}
 {tab==='my-work'&&<section className="panel"><div className="section-title"><div><h2>Upcoming Deliverables</h2><p className="hq-meta">Overdue work and team deadlines over the next seven days</p></div><Link href="/calendar">Full schedule →</Link></div>{upcoming.length?<ul className="hq-work-list">{upcoming.slice(0,5).map(r=><HqWorkItem key={r.id} record={r} now={now} project={projects.find(p=>p.id===r.data.projectId)} context={context}/>)}</ul>:<p className="hq-meta">No upcoming deadlines. Schedule work from a project.</p>}{upcoming.length>5&&<Link className="hq-more" href="/calendar">View all {upcoming.length} deadlines →</Link>}</section>}
 {tab==='activity'&&<HqRecentActivity staff={context.staff}/>}</div>;
}
