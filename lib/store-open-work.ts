import type {Deliverable,HqRecord,Project,WorkspaceRecord} from './hq-model.ts';
import {finished,instant} from './hq-operations.ts';
import {dueAfterStoreOpening} from './store-opening.ts';
import {dueState} from './hq-presentation.ts';
export type ChecklistItem={kind:'project';record:HqRecord<Project>;parent?:never;complete:boolean;department:string;owner:string;due:string}|{kind:'deliverable';record:HqRecord<Deliverable>;parent?:HqRecord<Project>;complete:boolean;department:string;owner:string;due:string};
export function checklistWork(records:WorkspaceRecord[]) {
 const projects=records.filter(r=>r.kind==='project'&&(r.data as Project).storeOpenChecklist) as HqRecord<Project>[];
 const parents=new Map(projects.map(p=>[p.id,p]));
 const deliverables=records.filter(r=>r.kind==='deliverable'&&!(r.data as Deliverable).deletedAt&&((r.data as Deliverable).storeOpenChecklist||parents.has((r.data as Deliverable).projectId))) as HqRecord<Deliverable>[];
 const items:ChecklistItem[]=[...projects.filter(p=>p.data.status!=='archived').map(record=>({kind:'project' as const,record,complete:record.data.status==='completed',department:record.data.department?.trim()||'',owner:record.data.owner,due:record.data.eventAt})),...deliverables.map(record=>{const parent=parents.get(record.data.projectId);return {kind:'deliverable' as const,record,parent,complete:finished(record.data),department:record.data.department?.trim()||parent?.data.department?.trim()||'',owner:record.data.owner,due:record.data.productionDue};})];
 const rank={urgent:0,high:1,normal:2,low:3};
 items.sort((a,b)=>(instant(a.due)??Infinity)-(instant(b.due)??Infinity)||rank[a.record.data.priority||'normal']-rank[b.record.data.priority||'normal']||a.record.data.title.localeCompare(b.record.data.title)||a.record.id.localeCompare(b.record.id));
 const completed=items.filter(i=>i.complete).length;
 return {projects,items,completed,open:items.length-completed,percent:items.length?Math.round(completed/items.length*100):0};
}
export function checklistTiming(item:ChecklistItem) {const due=instant(item.due);return due===null?'No deadline':dueAfterStoreOpening(item.due)?'Due after store opening':'';}
export function checklistGroup(item:ChecklistItem,by:'department'|'owner',name:(id:string)=>string){return by==='owner'?name(item.owner):item.department||name(item.owner);}

export function checklistDueState(date:string,complete:boolean,now:number|null) {const state=dueState(date,complete,now);return state==='On Track'?'Upcoming':state;}
