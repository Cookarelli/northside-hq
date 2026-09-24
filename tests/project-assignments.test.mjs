import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,blankDeliverable} from '../lib/hq-model.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
import {myAssignments,projectOwnerOptions,taskInput,workStatus} from '../lib/project-tasks.ts';
import {ownerColor} from '../lib/owner-colors.ts';

const projects=[{id:'auction',data:{...blankProject,title:'Auction campaign',owner:'brody',members:['jon','zach'],status:'active'}},{id:'closed',data:{...blankProject,owner:'jon',status:'completed'}}];
const task=(id,patch={})=>({id,data:{...blankDeliverable,workflow:'task',projectId:'auction',title:id,owner:'jon',contributors:['steve'],publishing:false,platforms:[],publications:{},status:'to_do',productionDue:'2026-09-24T09:00',priority:'normal',...patch}});

test('assignment filters keep direct work, approvals and blocks, exclude completed/deleted work, and use Central dates',()=>{
 const records=[task('normal'),task('urgent',{priority:'urgent',productionDue:'2026-09-25T14:00'}),task('today',{productionDue:'2026-09-23T23:30'}),task('overdue',{productionDue:'2026-09-22T09:00'}),task('later',{productionDue:'2026-09-28T09:00'}),task('deleted',{deletedAt:'2026-09-23T10:00:00Z'}),task('done',{status:'done'}),task('closed',{projectId:'closed'}),task('other',{owner:'steve',contributors:[]}),task('review',{workflow:undefined,projectId:'',owner:'steve',contributors:[],approver:'jon',status:'needs_review'}),task('block',{workflow:undefined,owner:'steve',contributors:[],blocked:true,blockedBy:'jon'})];
 const before=JSON.stringify(records),mine=myAssignments(records,projects,'jon',Date.parse('2026-09-24T03:00:00Z'));
 assert.equal(mine.all[0].id,'urgent');
 assert.deepEqual(mine.today.map(r=>r.id),['today']);
 assert.deepEqual(mine.overdue.map(r=>r.id),['overdue']);
 assert.ok(mine.week.some(r=>r.id==='normal'));assert.ok(!mine.week.some(r=>r.id==='later'));
 for(const id of ['deleted','done','closed','other'])assert.ok(!mine.all.some(r=>r.id===id),id);
 for(const id of ['review','block'])assert.ok(mine.all.some(r=>r.id===id),id);
 assert.deepEqual(mine.projects.map(p=>p.id),['auction']);assert.equal(JSON.stringify(records),before);
});

test('dated tasks have one linked calendar entry, follow edits, and disappear on recoverable deletion',()=>{
 let record=task('closing',{productionDue:'2026-09-27T21:00',endAt:'2026-09-27T22:00',waiting:true});
 const entries=()=>calendarEntries([record],projects,[],[],'2026-09-01','2026-09-30');
 assert.equal(entries().length,1);assert.equal(entries()[0].owner,'brody');assert.equal(entries()[0].endAt,'2026-09-27T22:00');assert.equal(entries()[0].status,'Waiting');
 assert.deepEqual(entries()[0].assigned,['jon','steve']);assert.equal(entries()[0].href,'/projects/auction?tab=deliverables&deliverable=closing#deliverable-closing');
 record={...record,data:{...record.data,productionDue:'2026-09-28T09:00',endAt:''}};
 assert.equal(entries().length,1);assert.equal(entries()[0].date,'2026-09-28T09:00');
 record={...record,data:{...record.data,deletedAt:'2026-09-23T12:00:00Z'}};assert.equal(entries().length,0);
});

test('primary owner choices reuse the live roster IDs and task validation rejects ambiguous schedules',()=>{
 const staff=['brody','nikb','nick','zach','joey','jon','steve'].map(id=>({id,name:id}));
 assert.deepEqual(Object.values(projectOwnerOptions(staff)),['Choose primary owner','Consignment','Nik','Nick','Zach','CEO','Jon','Steve']);
 assert.equal(projectOwnerOptions(staff,'legacy').legacy,'legacy (existing owner)');assert.equal(ownerColor('nikb').label,'Nik');
 const input={title:'Closing',instructions:'Watch the auction',projectId:'auction',assignees:['jon','steve'],productionDue:'2026-09-27T21:00',endAt:'2026-09-27T22:00',priority:'normal',notes:''};
 assert.equal(taskInput.safeParse(input).success,true);
 for(const patch of [{assignees:[]},{assignees:['jon','jon']},{endAt:'2026-09-27T20:00'},{productionDue:'2026-11-01T01:30'}])assert.equal(taskInput.safeParse({...input,...patch}).success,false);
 assert.equal(workStatus(task('x',{status:'done'}).data),'Complete');
});
