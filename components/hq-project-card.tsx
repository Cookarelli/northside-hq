import Link from 'next/link';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import {projectStatuses,type Deliverable,type HqRecord,type Project} from '@/lib/hq-model';
import {finished} from '@/lib/hq-operations';
import {primaryOwnerName} from '@/lib/project-tasks';
import {projectColor} from '@/lib/owner-colors';
import {dueState} from '@/lib/hq-presentation';
export function HqProjectCard({project,deliverables,name,now=null}:{project:HqRecord<Project>;deliverables:HqRecord<Deliverable>[];name:(id:string)=>string;now?:number|null}) {
 const p=project.data,work=deliverables.filter(d=>d.data.projectId===project.id&&!d.data.deletedAt),next=work.filter(d=>!finished(d.data)).sort((a,b)=>(a.data.productionDue||'9999').localeCompare(b.data.productionDue||'9999'))[0];
 const completed=work.filter(d=>finished(d.data)).length,date=next?.data.productionDue||p.eventAt||p.auctionClosesAt||p.auctionOpensAt;
 const assigned=[...new Set(p.members)];
 return <article className="panel hq-project-card" style={{borderLeftColor:projectColor(p,name).accent}}><h3><Link href={'/projects/'+project.id} title={p.title}>{p.title}</Link></h3><div className="hq-card-owner"><span>Owner: <strong>{primaryOwnerName(p.owner,name)}</strong></span><span className="tag">{projectStatuses[p.status]}</span></div><div className="hq-card-next"><span className="hq-meta">Next deliverable</span>{next?<Link href={'/projects/work/'+next.id} title={next.data.title}>{next.data.title}</Link>:<span>No open deliverables</span>}</div><p className="hq-card-date">{date?calendarDay(date)+' · '+calendarTime(date):'No due date'}<span className="hq-urgency">{dueState(date,p.status==='completed',now)}</span></p><div className="hq-card-staff"><span className="hq-meta">Assigned staff</span><p>{assigned.map(name).join(', ')||'No staff assigned'}</p></div>{!!work.length&&<label className="hq-project-progress"><span>{completed} of {work.length} complete</span><progress value={completed} max={work.length}/></label>}</article>;
}
