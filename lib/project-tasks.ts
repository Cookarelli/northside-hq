import {z} from 'zod';
import {chicagoInstant,chicagoWall} from './consignment.ts';
import {addDays,actionable,instant} from './hq-operations.ts';
import {canWork,productionStatuses,type Deliverable,type HqContext,type HqRecord,type Project,type Staff} from './hq-model.ts';

export const taskStatuses={not_started:'Not Started',in_progress:'In Progress',waiting:'Waiting',complete:'Complete'} as const;
export const taskPriorities={low:'Low',normal:'Normal',high:'High',urgent:'Urgent'} as const;
export type TaskStatus=keyof typeof taskStatuses;
export type TaskPriority=keyof typeof taskPriorities;
const wall=z.string().refine(value=>{if(!value)return true;try{chicagoInstant(value);return true;}catch{return false;}},'Choose a valid, unambiguous Chicago time.');
export const taskInput=z.object({title:z.string().trim().min(1).max(300),instructions:z.string().max(12000),projectId:z.string().min(1).max(180),assignees:z.array(z.string().min(1).max(180)).min(1).max(50).refine(v=>new Set(v).size===v.length),productionDue:wall,endAt:wall,priority:z.enum(['low','normal','high','urgent']),notes:z.string().max(12000)}).strict().refine(d=>!d.endAt||(!!d.productionDue&&d.endAt>d.productionDue),'The end must follow the due/start time.');
export type TaskInput=z.infer<typeof taskInput>;
export function taskStatus(d:Deliverable):TaskStatus {return d.status==='done'?'complete':d.waiting||d.status==='needs_review'||d.status==='ready'?'waiting':d.status==='to_do'?'not_started':'in_progress';}
export function workStatus(d:Deliverable){return d.workflow==='task'?taskStatuses[taskStatus(d)]:productionStatuses[d.status];}
export function taskAssignees(d:Deliverable){return [...new Set([d.owner,...d.contributors].filter(Boolean))];}
export function canManageTask(d:Deliverable|undefined,p:Project|undefined,c:HqContext){return c.admin||p?.owner===c.staffId||(!d?.projectId&&d?.approver===c.staffId);}
export function canCompleteTask(d:Deliverable,p:Project|undefined,c:HqContext){return !d.deletedAt&&canWork(d,p,c);}
export function primaryOwnerName(id:string,name:(id:string)=>string){return primaryOwnerChoices.find(([,ids])=>(ids as readonly string[]).includes(id))?.[0]||name(id)||'Unassigned';}
export function primaryOwnerLabel(id:string,staff:Staff[]){return primaryOwnerName(id,id=>staff.find(s=>s.id===id)?.name||id);}
export const primaryOwnerChoices=[['Consignment',['brody','consignment']],['Nik',['nikb','nik']],['Nick',['nick']],['Zach',['zach']],['CEO',['joey','ceo']],['Jon',['jon']],['Steve',['steve']]] as const;
export function projectOwnerOptions(staff:Staff[],current=''){
 const result:Record<string,string>={'':'Choose primary owner'};
 for(const [label,ids] of primaryOwnerChoices){const person=staff.find(s=>(ids as readonly string[]).includes(s.id))||staff.find(s=>s.name.toLowerCase()===label.toLowerCase());if(person)result[person.id]=label;}
 if(current&&!Object.hasOwn(result,current))result[current]=primaryOwnerLabel(current,staff)+' (existing owner)';
 return result;
}
const rank:Record<TaskPriority,number>={urgent:0,high:1,normal:2,low:3};
export function urgencySort(a:HqRecord<Deliverable>,b:HqRecord<Deliverable>){return rank[a.data.priority||'normal']-rank[b.data.priority||'normal']||(a.data.productionDue||'9999').localeCompare(b.data.productionDue||'9999')||a.id.localeCompare(b.id);}
export function myAssignments(records:HqRecord<Deliverable>[],projects:HqRecord<Project>[],staffId:string,now:number){
 const day=chicagoWall(now).slice(0,10),weekEnd=addDays(day,7-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7)-1);
 const assigned=records.filter(({data:d})=>{const project=projects.find(p=>p.id===d.projectId)?.data;return actionable(d,project)&&([d.owner,d.publisher,...d.contributors].includes(staffId)||(d.blocked&&d.blockedBy===staffId)||(d.status==='needs_review'&&(d.projectId?project?.owner:d.approver)===staffId));}).sort(urgencySort);
 return {all:assigned,today:assigned.filter(r=>r.data.productionDue.slice(0,10)===day),week:assigned.filter(r=>r.data.productionDue.slice(0,10)>=day&&r.data.productionDue.slice(0,10)<=weekEnd),overdue:assigned.filter(r=>(instant(r.data.productionDue)??Infinity)<now),projects:projects.filter(p=>!['completed','archived'].includes(p.data.status)&&(p.data.owner===staffId||p.data.members.includes(staffId)))};
}
