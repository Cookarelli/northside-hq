'use client';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {actionable,addDays,personName,todayDashboard} from '@/lib/hq-operations';
import {type Deliverable,type HqRecord,type Project} from '@/lib/hq-model';
import {calendarDay,calendarTime,type CalendarPost} from '@/lib/content-calendar';
import type {CampaignRecord} from '@/lib/consignment';
import {useHqClock} from '@/components/use-hq-clock';
import {useHqContext} from '@/components/use-hq-context';
import {HqCalendar} from '@/components/hq-calendar';
import {HqProjectCard} from '@/components/hq-project-card';
import {MyAssignments} from '@/components/my-assignments';
import {workStatus} from '@/lib/project-tasks';
import {HqRecentActivity} from '@/components/hq-recent-activity';
import {ownerColor,projectColor} from '@/lib/owner-colors';
export function HqToday({records,projects,posts,campaigns=[],loading,failed}:{records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];posts:CalendarPost[];campaigns?:CampaignRecord[];loading:boolean;failed:boolean}) {
 const {context,error,reload}=useHqContext(),now=useHqClock();
 if(failed)return <p className="panel" role="alert">Dashboard is unavailable. Retry loading the saved workspace above.</p>;
 if(error)return <div className="panel" role="alert">{error}<Button onClick={reload}>Retry dashboard</Button></div>;
 if(loading||!context||now===null)return <p role="status">Loading dashboard…</p>;
 const name=(id:string)=>personName(id,context.staff),parent=(d:Deliverable)=>projects.find(p=>p.id===d.projectId)?.data;
 const open=records.filter(r=>actionable(r.data,parent(r.data))).sort((a,b)=>(a.data.productionDue||'9999').localeCompare(b.data.productionDue||'9999'));
 const data=todayDashboard(records,projects,context.staffId,now),reviewIds=new Set(data.approvals.map(r=>r.id));
 const list=(items:HqRecord<Deliverable>[])=>items.length?<ul className="hq-deliverables">{items.map(({id,data:d})=>{const p=parent(d),color=p?projectColor(p,name):ownerColor(d.owner,name(d.owner));return <li key={id} className="hq-owner-row" style={{borderLeftColor:color.accent}}><div><Link href={'/projects/work/'+id}>{d.title}</Link><p>{p?.title||'Standalone'} · Owner: {name(d.owner)}</p><p>Assigned: {[...new Set([d.owner,d.publisher,...d.contributors].filter(Boolean))].map(name).join(', ')||'Unassigned'}</p><p>{d.productionDue?calendarDay(d.productionDue)+' · '+calendarTime(d.productionDue):'Due date not set'}</p>{d.blocked&&<p>Blocked · {d.blockedReason}</p>}{reviewIds.has(id)&&<p>Needs your approval</p>}</div><span className="tag">{workStatus(d)}</span></li>;})}</ul>:<p className="muted">No work in this section.</p>;
 return <div className="hq-dashboard"><HqCalendar records={records} projects={projects} posts={posts} campaigns={campaigns} staff={context.staff}/>
 <section><div className="section-title"><h2>Active Projects</h2><Link href="/projects">All projects →</Link></div><div className="hq-project-grid">{projects.filter(p=>p.data.status==='active').map(p=><HqProjectCard key={p.id} project={p} deliverables={records} name={name}/>)}</div>{!projects.some(p=>p.data.status==='active')&&<p className="panel">No active projects. Draft and completed projects remain in <Link href="/projects">Projects</Link>.</p>}</section>
 <section className="panel"><h2>Upcoming Deliverables / Deadlines</h2><p className="muted">Next seven days and overdue work</p>{list(open.filter(r=>r.data.productionDue&&r.data.productionDue.slice(0,10)<=addDays(data.day,7)))}</section>
 <MyAssignments records={records} projects={projects} context={context} now={now}/>
 <HqRecentActivity staff={context.staff}/></div>;
}
