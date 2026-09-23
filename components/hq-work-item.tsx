'use client';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import type {Deliverable,HqRecord,HqContext,Project} from '@/lib/hq-model';
import {primaryOwnerLabel,taskAssignees,taskPriorities,taskStatus,taskStatuses,workStatus} from '@/lib/project-tasks';
import {finished} from '@/lib/hq-operations';
import {dueState,quickTaskAllowed} from '@/lib/hq-presentation';
import {ownerColor,projectColor} from '@/lib/owner-colors';
import type {Action} from '@/components/hq-workspace';

export function HqWorkItem({record,project,context,act,busy=false,onEdit,statusControl=false,now=null}:{record:HqRecord<Deliverable>;project?:HqRecord<Project>;context:HqContext;act?:Action;busy?:boolean;onEdit?:()=>void;statusControl?:boolean;now?:number|null}) {
  const d=record.data,name=(id:string)=>context.staff.find(s=>s.id===id)?.name||id||'Unassigned',color=project?projectColor(project.data,name):ownerColor(d.owner,name(d.owner));
  const canUpdate=!!act&&quickTaskAllowed(d,project?.data,context);
  return <li className="hq-work-item" style={{borderLeftColor:color.accent}}>
    <div className="hq-work-copy"><Link className="hq-work-title" href={'/projects/work/'+record.id}>{d.title}</Link>
      <p className="hq-meta">{project?<Link href={'/projects/'+project.id}>{project.data.title}</Link>:'Standalone'} · Owner: {primaryOwnerLabel(project?.data.owner||d.owner,context.staff)}</p>
      <p className="hq-work-date"><span className="hq-urgency">{dueState(d.productionDue,finished(d),now)==='Overdue'?'Overdue · ':''}</span>{d.productionDue?<time dateTime={d.productionDue}>{calendarDay(d.productionDue)} · {calendarTime(d.productionDue)}</time>:'Unscheduled'}{d.endAt?' – '+calendarDay(d.endAt)+' '+calendarTime(d.endAt):''}</p>
      <p className="hq-meta">Assigned: {taskAssignees(d).map(name).join(', ')||'Unassigned'}</p>
      {d.blocked&&<p className="hq-meta">Blocked · {d.blockedReason}</p>}
    </div>
    <div className="hq-work-actions"><div className="hq-work-tags"><span className="tag">{workStatus(d)}</span><span className="hq-meta">{taskPriorities[d.priority||'normal']} priority</span></div>
      <div className="button-row">{canUpdate&&statusControl&&<label className="field"><span className="sr-only">Status for {d.title}</span><select aria-label={'Status for '+d.title} disabled={busy} value={taskStatus(d)} onChange={e=>void act!({action:'task-status',id:record.id,version:d.version,status:e.target.value})}>{Object.entries(taskStatuses).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}
      {canUpdate&&d.status!=='done'&&<Button variant="outline" disabled={busy} aria-label={'Mark complete: '+d.title} onClick={()=>void act!({action:'task-status',id:record.id,version:d.version,status:'complete'})}>Mark complete</Button>}
      {onEdit&&<Button variant="outline" disabled={busy} onClick={onEdit} aria-label={'Edit schedule and staff: '+d.title}>Edit</Button>}</div>
    </div>
  </li>;
}
