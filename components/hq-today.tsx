'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {todayDashboard,nextAction,personName,type ScheduleRow} from '@/lib/hq-operations';
import {productionStatuses,type Deliverable,type HqRecord,type Project,type Staff} from '@/lib/hq-model';
import {calendarDay,calendarTime,type CalendarPost} from '@/lib/content-calendar';
import {todayWork} from '@/lib/hq-today';
import {useHqClock} from '@/components/use-hq-clock';
import {useHqContext} from '@/components/use-hq-context';
export function HqToday({records,projects,posts,loading,failed}:{records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];posts:CalendarPost[];loading:boolean;failed:boolean}){
 const {context,error,reload}=useHqContext(),[view,setView]=useState<'mine'|'team'>('mine');const now=useHqClock();
 if(failed)return <p className="panel" role="alert">Today is unavailable. Retry loading the saved workspace above.</p>;
 if(error)return <div className="panel" role="alert">{error}<Button onClick={reload}>Retry Today</Button></div>;
 if(loading||!context||now===null)return <p role="status">Preparing Today…</p>;
 const data=todayDashboard(records,projects,context.staffId,now),legacy=todayWork(posts,now),staff=context.staff;
 const work=(title:string,items:HqRecord<Deliverable>[],empty:string)=><WorkSection title={title} records={items} projects={projects} staff={staff} empty={empty}/>;
 return <><p>{calendarDay(data.day)} · America/Chicago</p><div className="button-row" role="group" aria-label="Today view"><Button aria-pressed={view==='mine'} variant={view==='mine'?'default':'outline'} onClick={()=>setView('mine')}>My Work</Button><Button aria-pressed={view==='team'} variant={view==='team'?'default':'outline'} onClick={()=>setView('team')}>Team</Button></div>
 {view==='mine'?<>
 {work('My work due soon or overdue',data.dueSoon,'No assigned production deadlines in the next seven days or overdue. Open Projects to find your other work.')}
 {work('Awaiting my approval',data.approvals,'No submitted work is waiting for your approval.')}
 {work('Blocks requiring my action',data.myBlocks,'You are not currently responsible for resolving any blocks.')}
 <PublishingSection title="My publishing assignments today" rows={data.myPublishing} staff={staff} empty="No publishing destinations are assigned to you today."/>
 </>:<>
 <PublishingSection title="Today and tomorrow’s publishing" rows={data.publishing} staff={staff} empty="No publication dates are planned for today or tomorrow."/>
 <div className="hq-columns"><PublishingSection title="Ready to hand off" rows={data.ready} staff={staff} empty="No pending destinations have current approval in this two-day window."/><PublishingSection title="Unfinished publishing work" rows={data.unfinished} staff={staff} empty="No pending destinations need production or review in this two-day window."/></div>
 {work('Overdue production',data.overdue,'No open production deadlines are overdue.')}
 <PublishingSection title="Overdue publishing" rows={data.overduePublishing} staff={staff} empty="No pending publication times are overdue."/>
 {work('Blocked work',data.blocked,'No open work is marked blocked.')}
 <section className="panel"><h2>Projects approaching key dates</h2><p className="muted">Next seven days · projects with missing inputs</p>{data.missingProjects.length?<ul className="hq-deliverables">{data.missingProjects.map(p=><li key={p.id}><div><Link href={'/projects/'+p.id}>{p.data.title}</Link><p>{calendarDay(p.date)} · {calendarTime(p.date)} · {personName(p.data.owner,staff)}</p><ul>{p.missing.map((m,i)=><li key={i}>{m}</li>)}</ul></div></li>)}</ul>:<p>No approaching projects have missing inputs.</p>}</section>
 {work('Unassigned work',data.unassigned,'Every open deliverable has an accountable owner and, where needed, a publisher.')}
 {data.unassignedProjects.length>0&&<section className="panel"><h2>Projects needing an owner</h2><ul>{data.unassignedProjects.map(p=><li key={p.id}><Link href={'/projects/'+p.id}>{p.data.title}</Link> · Assign a project owner</li>)}</ul></section>}
 </>}
 <details className="panel hq-details"><summary>Existing calendar activity</summary><p>Legacy entries and recurring series stay in their existing editor. Their old status labels are not HQ platform confirmations.</p>{legacy.scheduled.length?<ul>{legacy.scheduled.map(p=><li key={p.id}>{p.data.title} · {calendarTime(p.data.date)} · legacy {p.data.status}</li>)}</ul>:<p>No existing dated calendar entries today.</p>}<Link href="/calendar">Open Calendar and recurring series →</Link></details>
 </>;
}
function WorkSection({title,records,projects,staff,empty}:{title:string;records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];staff:Staff[];empty:string}){return <section className="panel"><h2>{title}</h2>{records.length?<ul className="hq-deliverables">{records.map(({id,data:d})=><li key={id}><div><Link href={'/projects/work/'+id}>{d.title}</Link><p>Owner: {personName(d.owner,staff)}{d.blocked?' · Resolver: '+personName(d.blockedBy,staff):''}</p><p>{d.productionDue?calendarDay(d.productionDue)+' · '+calendarTime(d.productionDue):'Production deadline missing'}</p><p className="muted">Next: {nextAction(d,projects.find(p=>p.id===d.projectId)?.data)}</p></div><span className="tag">{productionStatuses[d.status]}</span></li>)}</ul>:<p className="muted">{empty}</p>}</section>;}
export function PublishingSection({title,rows,staff,empty}:{title:string;rows:ScheduleRow[];staff:Staff[];empty:string}){return <section className="panel"><h2>{title}</h2>{rows.length?<ul className="hq-deliverables">{rows.map(r=><li key={r.key}><div><Link href={'/projects/work/'+r.id}>{r.title}</Link><p>{r.platform} · {calendarDay(r.date)} · {calendarTime(r.date)}</p><p>Publisher: {personName(r.publisher,staff)} · Owner: {personName(r.owner,staff)}</p><p className="muted">{r.status==='published'?'Publication recorded':r.status==='scheduled'?'Next: check the live post at the confirmed time':r.action}</p></div><span className="tag">{r.stateLabel}{r.status==='planned'?' · '+(r.ready?'Ready':'Unfinished'):''}</span></li>)}</ul>:<p className="muted">{empty}</p>}</section>;}
