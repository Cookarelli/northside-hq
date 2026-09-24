import Link from 'next/link';
import {deliverableHref} from '@/lib/auction-campaigns';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import {projectStatuses,projectTypes,type Deliverable,type HqRecord,type Project} from '@/lib/hq-model';
import {finished} from '@/lib/hq-operations';
import {primaryOwnerName} from '@/lib/project-tasks';
import {projectColor} from '@/lib/owner-colors';
import {checklistDueState} from '@/lib/store-open-work';
import {dueState} from '@/lib/hq-presentation';
import {HqStatus} from '@/components/hq-status';

export function HqProjectCard({project,deliverables,name,now=null}:{project:HqRecord<Project>;deliverables:HqRecord<Deliverable>[];name:(id:string)=>string;now?:number|null}) {
 const p=project.data,work=deliverables.filter(d=>d.data.projectId===project.id&&!d.data.deletedAt),next=work.filter(d=>!finished(d.data)).sort((a,b)=>(a.data.productionDue||'9999').localeCompare(b.data.productionDue||'9999'))[0];
 const completed=work.filter(d=>finished(d.data)).length,date=next?.data.productionDue||p.eventAt||p.auctionClosesAt||p.auctionOpensAt;
 const timing=(p.storeOpenChecklist?checklistDueState:dueState)(date,p.status==='completed',now);
 return <article className="panel hq-project-card">
  <div className="hq-card-top"><span className="hq-meta">{projectTypes[p.type]}</span><HqStatus>{projectStatuses[p.status]}</HqStatus></div>
  <h3><Link className="hq-card-link" href={'/projects/'+project.id}>{p.title}</Link></h3>
  <p className="hq-card-owner"><span className="hq-owner-dot" style={{background:projectColor(p,name).accent}} aria-hidden="true"/>{primaryOwnerName(p.owner,name)}</p>
  {next&&<p className="hq-card-next"><span className="hq-meta">Next</span><Link href={deliverableHref(next.id,next.data)} title={next.data.title}>{next.data.title}</Link></p>}
  <p className="hq-card-date">{date?calendarDay(date)+' · '+calendarTime(date):'No due date'}{['Overdue','Due Soon'].includes(timing)&&<HqStatus>{timing}</HqStatus>}</p>
  {!!work.length&&<label className="hq-project-progress"><span>{completed} of {work.length} complete</span><progress value={completed} max={work.length}/></label>}
 </article>;
}
