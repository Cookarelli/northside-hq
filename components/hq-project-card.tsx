import Link from 'next/link';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import {projectStatuses,type Deliverable,type HqRecord,type Project} from '@/lib/hq-model';
import {finished} from '@/lib/hq-operations';
import {primaryOwnerName} from '@/lib/project-tasks';
import {projectColor} from '@/lib/owner-colors';
export function HqProjectCard({project,deliverables,name}:{project:HqRecord<Project>;deliverables:HqRecord<Deliverable>[];name:(id:string)=>string}) {
 const p=project.data,work=deliverables.filter(d=>d.data.projectId===project.id&&!d.data.deletedAt),next=work.filter(d=>!finished(d.data)).sort((a,b)=>(a.data.productionDue||'9999').localeCompare(b.data.productionDue||'9999'))[0];
 const completed=work.filter(d=>finished(d.data)).length,date=next?.data.productionDue||p.eventAt||p.auctionClosesAt||p.auctionOpensAt;
 const assigned=[...new Set(p.members)];
 return <article className="panel hq-project-card" style={{borderLeftColor:projectColor(p,name).accent}}><h3><Link href={'/projects/'+project.id}>{p.title}</Link></h3><p>Primary owner: {primaryOwnerName(p.owner,name)}</p><p>Assigned: {assigned.map(name).join(', ')||'Unassigned'}</p><p>Next: {next?<Link href={'/projects/work/'+next.id}>{next.data.title}</Link>:'No open deliverables'}</p><p>Due: {date?calendarDay(date)+' · '+calendarTime(date):'Not set'}</p><span className="tag">{projectStatuses[p.status]}</span>{!!work.length&&<label className="hq-project-progress"><span>{completed} / {work.length} deliverables complete</span><progress value={completed} max={work.length}/></label>}</article>;
}
