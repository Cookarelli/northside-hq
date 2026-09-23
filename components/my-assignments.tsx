'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import type {Deliverable,HqContext,HqRecord,Project} from '@/lib/hq-model';
import {myAssignments,taskPriorities,workStatus,primaryOwnerLabel} from '@/lib/project-tasks';
export function MyAssignments({records,projects,context,now}:{records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];context:HqContext;now:number}) {
 const [filter,setFilter]=useState<'all'|'today'|'week'|'overdue'>('all'),data=myAssignments(records,projects,context.staffId,now);
 return <section className="panel"><h2>My Assignments</h2><div className="button-row" role="group" aria-label="Assignment due dates">{([['all','All'],['today','Due today'],['week','Due this week'],['overdue','Overdue']] as const).map(([key,label])=><Button key={key} variant={filter===key?'default':'outline'} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label} ({data[key].length})</Button>)}</div>
 <p className="muted">Sorted by priority, then due date · Central time</p><ul className="hq-deliverables">{data[filter].map(({id,data:d})=><li key={id}><div><Link href={'/projects/work/'+id}>{d.title}</Link><p>{projects.find(p=>p.id===d.projectId)?.data.title||'Standalone'}</p><p>{d.productionDue?calendarDay(d.productionDue)+' · '+calendarTime(d.productionDue):'Unscheduled'}</p></div><div><span className="tag">{taskPriorities[d.priority||'normal']}</span><p>{workStatus(d)}</p></div></li>)}</ul>{!data[filter].length&&<p>No assigned deliverables in this view.</p>}
 <h3>My projects</h3><ul className="hq-deliverables">{data.projects.map(p=><li key={p.id}><Link href={'/projects/'+p.id}>{p.data.title}</Link><span>Primary owner: {primaryOwnerLabel(p.data.owner,context.staff)}</span></li>)}</ul>{!data.projects.length&&<p>No active project assignments.</p>}</section>;
}
