import {chicagoWall} from './consignment.ts';
import {finished,instant} from './hq-operations.ts';
import {myAssignments,canCompleteTask} from './project-tasks.ts';
import type {Deliverable,HqContext,HqRecord,Project} from './hq-model.ts';

// Presentation only: the underlying workflow states and permissions stay intact.
export function statusTone(label:string) {
 const status=label.toLowerCase();
 if(['overdue','blocked','declined'].includes(status))return 'attention';
 if(['complete','completed','published','done','accepted','reconciled'].includes(status))return 'complete';
 if(['ready for review','needs review','ready','due soon'].includes(status))return 'review';
 if(['in progress','active','scheduled'].includes(status))return 'progress';
 return 'neutral';
}

export function assignmentGroups(records:HqRecord<Deliverable>[],projects:HqRecord<Project>[],staffId:string,now:number) {
  const data=myAssignments(records,projects,staffId,now),today=chicagoWall(now).slice(0,10);
  const overdue=data.overdue,ids=new Set(overdue.map(r=>r.id));
  const dueToday=data.all.filter(r=>!ids.has(r.id)&&r.data.productionDue.slice(0,10)===today);
  dueToday.forEach(r=>ids.add(r.id));
  // The shared UI clock is rounded to the minute; include server completions within that minute.
  const recent=records.filter(({data:d})=>!d.deletedAt&&finished(d)&&[d.owner,d.publisher,...d.contributors].includes(staffId)&&!!d.completedAt&&Date.parse(d.completedAt)<now+60000&&Date.parse(d.completedAt)>=now-7*86400000).sort((a,b)=>b.data.completedAt!.localeCompare(a.data.completedAt!));
  return {groups:[{id:'overdue',label:'Overdue',records:overdue},{id:'today',label:'Today',records:dueToday},{id:'upcoming',label:'Upcoming',records:data.all.filter(r=>!ids.has(r.id))},{id:'complete',label:'Completed recently',records:recent}].filter(g=>g.records.length),projects:data.projects};
}
export function dueState(date:string,complete:boolean,now:number|null) {
  if(complete)return 'Complete';
  if(!date||now===null)return 'On Track';
  const due=instant(date);
  return due===null?'On Track':due<now?'Overdue':due<=now+2*86400000?'Due Soon':'On Track';
}
export function quickTaskAllowed(d:Deliverable,p:Project|undefined,c:HqContext) {
  return d.workflow==='task'&&canCompleteTask(d,p,c)&&!['completed','archived'].includes(p?.status||'');
}

export function activityLabel(action:string){
 const labels:Record<string,string>={'save-task':'Updated deliverable','task-status':'Changed deliverable status','task-delete':'Removed deliverable','task-restore':'Restored deliverable','task-metadata':'Updated priority or notes','save-project':'Updated project','save-deliverable':'Updated deliverable','reschedule':'Changed due date'};
 return labels[action]||action.replaceAll('-',' ').replaceAll('_',' ');
}
