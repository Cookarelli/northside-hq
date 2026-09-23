import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assignmentGroups,dueState,quickTaskAllowed} from '../lib/hq-presentation.ts';
import {blankDeliverable,blankProject} from '../lib/hq-model.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
const now=Date.parse('2026-09-23T17:00:00Z');
const project={id:'p',data:{...blankProject,status:'active',owner:'steve',members:['jon'],title:'Auction'}};
const task=(id,due,extra={})=>({id,data:{...blankDeliverable,workflow:'task',owner:'jon',contributors:[],publisher:'',projectId:'p',productionDue:due,status:'to_do',title:id,publications:{},...extra}});
test('assignment groups are disjoint, use Chicago dates, and retain recent completed history',()=>{
 const rows=[task('late','2026-09-23T09:00'),task('today','2026-09-23T18:00'),task('next','2026-09-24T09:00'),task('undated',''),task('complete','2026-09-22T09:00',{status:'done',completedAt:'2026-09-23T16:00:00Z'}),task('old','',{status:'done',completedAt:'2026-08-01T16:00:00Z'}),task('removed','2026-09-22T09:00',{deletedAt:'2026-09-23T16:00:00Z'})];
 const result=assignmentGroups(rows,[project],'jon',now);
 assert.deepEqual(result.groups.map(g=>[g.id,g.records.map(r=>r.id)]),[['overdue',['late']],['today',['today']],['upcoming',['next','undated']],['complete',['complete']]]);
 assert.deepEqual(result.projects.map(p=>p.id),['p']);
 assert.equal(new Set(result.groups.flatMap(g=>g.records.map(r=>r.id))).size,5);
 assert.deepEqual(assignmentGroups(rows,[{...project,data:{...project.data,status:'archived'}}],'jon',now).groups.map(g=>g.id),['complete']);
});
test('quick completion respects workflow, assignment, deletion and closed projects',()=>{
 const d=task('t','').data,c={staffId:'jon',admin:false};
 assert.equal(quickTaskAllowed(d,project.data,c),true);
 assert.equal(quickTaskAllowed(d,project.data,{...c,staffId:'nick'}),false);
 assert.equal(quickTaskAllowed({...d,workflow:undefined},project.data,c),false);
 assert.equal(quickTaskAllowed({...d,deletedAt:'2026-09-23'},project.data,c),false);
 assert.equal(quickTaskAllowed(d,{...project.data,status:'completed'},c),false);
});
test('urgency uses due instant without replacing owner identity',()=>{
 assert.equal(dueState('2026-09-23T09:00',false,now),'Overdue');
 assert.equal(dueState('2026-09-24T09:00',false,now),'Due Soon');
 assert.equal(dueState('2026-10-24T09:00',false,now),'On Track');
 assert.equal(dueState('2026-09-23T09:00',true,now),'Complete');
});
test('rescheduled canonical work moves once and completed work keeps its detail link',()=>{
 const original=task('t','2026-09-23T09:00'),rescheduled={...original,data:{...original.data,productionDue:'2026-09-25T14:00'}};
 const entries=calendarEntries([rescheduled],[project],[],[],'2026-09-01','2026-09-30');
 assert.equal(entries.length,1);assert.equal(entries[0].date,'2026-09-25T14:00');assert.equal(entries[0].href,'/projects/work/t');
 const complete={...rescheduled,data:{...rescheduled.data,status:'done',completedAt:'2026-09-23T16:00:00Z'}};
 assert.equal(assignmentGroups([complete],[project],'jon',now).groups[0].id,'complete');
 const doneEntries=calendarEntries([complete],[project],[],[],'2026-09-01','2026-09-30');assert.equal(doneEntries.length,1);assert.equal(doneEntries[0].status,'Complete');
 assert.equal(calendarEntries([{...original,data:{...original.data,status:'in_progress',waiting:true}}],[project],[],[],'2026-09-01','2026-09-30')[0].status,'Waiting');
});
