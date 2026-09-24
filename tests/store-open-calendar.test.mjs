import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,blankDeliverable} from '../lib/hq-model.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
import {chicagoInstant} from '../lib/consignment.ts';
import {checklistDueState} from '../lib/store-open-work.ts';
import {dueAfterStoreOpening,storeOpeningCountdown,STORE_OPENING_INSTANT,STORE_OPENING_WALL} from '../lib/store-opening.ts';

const project={id:'opening-project',data:{...blankProject,title:'Prepare the store',owner:'jon',members:['brody'],storeOpenChecklist:true,status:'active',eventAt:STORE_OPENING_WALL}};
const task=(id,patch={})=>({id,data:{...blankDeliverable,title:id,workflow:'task',projectId:project.id,owner:'brody',productionDue:'2026-11-19T14:00',status:'to_do',publishing:false,platforms:[],publications:{},...patch}});

test('calendar derives one opening milestone in the correct range without writing or mutating records',()=>{
 const projects=[project],work=[task('child'),task('direct',{storeOpenChecklist:true,projectId:''})],before=structuredClone({projects,work});
 const month=()=>calendarEntries(work,projects,[],[],'2026-11-01','2026-11-30');
 const milestone=month().filter(e=>e.milestone==='store-opening');
 assert.equal(milestone.length,1);assert.equal(milestone[0].title,'Northside Store Opens');assert.equal(milestone[0].date,'2026-11-20T15:00');assert.equal(chicagoInstant(milestone[0].date),Date.parse('2026-11-20T21:00:00Z'));assert.equal(milestone[0].href,'/projects?tab=store-open-checklist');
 assert.deepEqual(month(),month());assert.deepEqual({projects,work},before);
 for(const [start,end,count] of [['2026-11-20','2026-11-20',1],['2026-11-15','2026-11-21',1],['2026-11-01','2026-11-19',0],['2026-11-21','2026-12-31',0]])assert.equal(calendarEntries(work,projects,[],[],start,end).filter(e=>e.milestone).length,count);
 assert.equal(calendarEntries([],[],[],[],'2026-11-01','2026-11-30').length,1,'Milestone exists even before the first work item');
 assert.equal(month().filter(e=>e.date.startsWith('2026-11-20'))[0].milestone,'store-opening','Milestone stays visible above other same-day work');
});

test('checklist project and child/direct deliverables share existing calendar records and correct tabs',()=>{
 const p=structuredClone(project),child=task('child'),direct=task('direct',{storeOpenChecklist:true,projectId:''}),work=[child,direct];
 const entries=()=>calendarEntries(work,[p],[],[],'2026-11-01','2026-11-30');
 assert.equal(entries().length,4);
 assert.equal(entries().find(e=>e.key==='opening-projectEvent').href,'/projects/opening-project?tab=overview');
 assert.equal(entries().find(e=>e.key==='child:production').href,'/projects/opening-project?tab=deliverables&deliverable=child#deliverable-child');
 assert.equal(entries().find(e=>e.key==='direct:production').href,'/projects/work/direct');
 assert.equal(entries().find(e=>e.key==='direct:production').project,'Store Open Checklist');
 assert.ok(entries().filter(e=>!e.milestone).every(e=>e.checklist));
 child.data.productionDue='2026-11-21T09:00';child.data.status='done';p.data.eventAt='2026-11-18T09:00';
 assert.equal(entries().filter(e=>e.key==='child:production').length,1);assert.equal(entries().find(e=>e.key==='child:production').date,'2026-11-21T09:00');assert.equal(entries().find(e=>e.key==='child:production').complete,true);
 direct.data.deletedAt='2026-11-19T20:00:00Z';assert.ok(!entries().some(e=>e.key==='direct:production'));
 assert.equal(entries().filter(e=>e.milestone).length,1);
});

test('opening warning compares instants, allows the exact deadline and handles the fall timezone change',()=>{
 for(const value of ['', 'invalid','2026-11-20T15:00','2026-11-20T21:00:00Z','2026-11-20T14:59','2026-10-31T15:00'])assert.equal(dueAfterStoreOpening(value),false,value);
 for(const value of ['2026-11-20T15:01','2026-11-20T21:01:00Z','2026-11-20T16:01:00-05:00','2026-11-21T09:00'])assert.equal(dueAfterStoreOpening(value),true,value);
});

test('quiet countdown has days or days/hours only, including the final hour and after opening',()=>{
 const remaining=duration=>storeOpeningCountdown(STORE_OPENING_INSTANT-duration);
 assert.equal(storeOpeningCountdown(null),'');assert.equal(remaining(57*86400000+3*3600000),'57 days until opening');
 assert.equal(remaining(3*86400000+4*3600000+123456),'3 days, 4 hours until opening');
 assert.equal(remaining(86400000+3600000),'1 day, 1 hour until opening');assert.equal(remaining(3600000),'1 hour until opening');
 assert.equal(remaining(30*60000),'Opening within the hour');assert.equal(remaining(0),'Store Opened');assert.equal(remaining(-60000),'Store Opened');
 const a=storeOpeningCountdown(chicagoInstant('2026-10-31T15:00')),b=storeOpeningCountdown(Date.parse('2026-10-31T20:00:00Z'));assert.equal(a,b);
});

test('simple work indicators reuse the 48-hour rule; completion takes precedence over lateness',()=>{
 const now=chicagoInstant('2026-11-18T15:00');
 assert.equal(checklistDueState('2026-11-20T15:01',false,now),'Upcoming');
 assert.equal(checklistDueState('2026-11-20T15:00',false,now),'Due Soon');
 assert.equal(checklistDueState('2026-11-18T15:00',false,now),'Due Soon');
 assert.equal(checklistDueState('2026-11-18T14:59',false,now),'Overdue');
 assert.equal(checklistDueState('2026-11-18T14:59',true,now),'Complete');
 assert.equal(checklistDueState('',false,now),'Upcoming');assert.equal(checklistDueState('',true,null),'Complete');
});
