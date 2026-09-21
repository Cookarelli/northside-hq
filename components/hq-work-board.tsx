'use client';
import {useState} from 'react';
import Link from 'next/link';
import {CheckSquare2, Clock3, CalendarDays, CircleCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Assignee, DueDate, EmptyState, SectionHeader, StatCard, StatusBadge} from '@/components/hq-ui';
import {useHqClock} from '@/components/use-hq-clock';
import {taskDeadline, taskGroups, taskViews, type TaskView} from '@/lib/hq-sections';
import {workStatus} from '@/lib/hq-presentation';
import {overviewComplete} from '@/lib/hq-overview';
import {instant,nextAction} from '@/lib/hq-operations';
import type {Deliverable,HqContext,HqRecord,Project} from '@/lib/hq-model';

export function HqWorkBoard({records,projects,context,onCreate}:{records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];context:HqContext;onCreate:()=>void}) {
 const [view,setView]=useState<TaskView>('My Tasks'),[search,setSearch]=useState('');
 const now=useHqClock();
 if(now===null)return <p role="status">Preparing your tasks…</p>;
 const groups=taskGroups(records,projects,context.staffId,now),shown=groups[view].filter(r=>r.data.title.toLowerCase().includes(search.toLowerCase()));
 const names=new Map(context.staff.map(p=>[p.id,p.name]));
 return <>
  <div className="hq-stat-grid"><StatCard label="My Tasks" value={groups['My Tasks'].length} description="Your open assignments" icon={CheckSquare2}/><StatCard label="Due Today" value={groups['Due Today'].length} description="Team deadlines today" icon={CalendarDays}/><StatCard label="Overdue" value={groups.Overdue.length} description="Open deadlines that have passed" icon={Clock3}/><StatCard label="Completed" value={groups.Completed.length} description="Completed work on record" icon={CircleCheck}/></div>
  <section className="panel"><div className="hq-work-tabs" role="group" aria-label="Task views">{taskViews.map(label=><Button key={label} variant="ghost" aria-pressed={view===label} onClick={()=>setView(label)}>{label}<span>{groups[label].length}</span></Button>)}</div>
   <SectionHeader title={view} description={view==='My Tasks'?'Tasks you own, contribute to, or publish.':'Team work grouped by its current deadline and status.'}/>
   <label className="field hq-compact-search"><span>Find a task</span><Input type="search" placeholder="Search task titles…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   {shown.length?<ul className="hq-task-rows">{shown.map(({id,data:d})=>{const p=projects.find(p=>p.id===d.projectId)?.data,complete=overviewComplete(d);return <li key={id}><div><span className="hq-overview-kind">{p?.title||'Standalone task'}</span><h3><Link href={'/projects/work/'+id}>{d.title}</Link></h3><p className="muted">{complete?'Completed':nextAction(d,p)}</p><div className="hq-overview-meta"><Assignee name={names.get(d.owner)||(d.owner?'Staff member':'Unassigned')}/><DueDate value={taskDeadline(d)} overdue={!complete&&(instant(taskDeadline(d))??Infinity)<now}/></div></div><div className="hq-task-action"><StatusBadge status={complete?'complete':workStatus(d,p)}/><Button asChild variant="outline"><Link href={'/projects/work/'+id}>{d.status==='needs_review'?'Review':'Open Task'}</Link></Button></div></li>;})}</ul>:<EmptyState icon={CheckSquare2} title={search?'No matching tasks':view==='My Tasks'?'No tasks assigned to you':view==='Due Today'?'No tasks due today':view==='Upcoming'?'No upcoming tasks':view==='Overdue'?'No overdue tasks':view==='All Tasks'?'No tasks yet':'No completed tasks yet'} description={search?'Try another title to find the work you need.':view==='Completed'?'Finished tasks will appear here so the team can follow what was delivered.':'Add a task with an owner and due date to make the next step clear.'} action={search?<Button variant="outline" onClick={()=>setSearch('')}>Clear Search</Button>:<Button onClick={onCreate}>Add Task</Button>}/>}
  </section>
 </>;
}
