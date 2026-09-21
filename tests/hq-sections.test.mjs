import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankDeliverable,blankProject} from '../lib/hq-model.ts';
import {chicagoInstant} from '../lib/consignment.ts';
import {taskGroups,taskDeadline,campaignLifecycle,campaignNext,calendarWindow,moveCalendar,reportingSources} from '../lib/hq-sections.ts';
const p={kind:'project',id:'p',data:{...blankProject,title:'Campaign',owner:'a',brief:'Brief',status:'active'}};
const w=(id,patch={})=>({id,kind:'deliverable',data:{...blankDeliverable,title:id,publications:{},projectId:'p',owner:'a',status:'in_progress',...patch}});
test('task views use Central day and omit closed campaign work',()=>{
 const rows=[w('late',{productionDue:'2026-03-08T10:00'}),w('next',{productionDue:'2026-03-09T10:00'}),w('done',{status:'done'}),w('closed',{projectId:'closed',productionDue:'2026-03-08T09:00'})];
 const groups=taskGroups(rows,[p,{...p,id:'closed',data:{...p.data,status:'archived'}}],'a',chicagoInstant('2026-03-08T12:00'));
 assert.deepEqual(groups['Due Today'].map(r=>r.id),['late']);assert.deepEqual(groups.Overdue.map(r=>r.id),['late']);assert.deepEqual(groups.Upcoming.map(r=>r.id),['next']);assert.deepEqual(groups.Completed.map(r=>r.id),['done']);assert.equal(groups['My Tasks'].length,2);
});
test('ready publishing tasks use earliest unfinished destination date',()=>{
 assert.equal(taskDeadline(w('x',{status:'ready',publishing:true,platforms:['facebook','instagram'],publishAt:'2026-03-09T12:00',publications:{facebook:{status:'published'},instagram:{status:'scheduled',scheduledFor:'2026-03-10T14:00'}}}).data),'2026-03-10T14:00');
});
test('consignment lifecycle retains missing stages and requires all stage tasks complete',()=>{
 const project={...p.data,legacyCampaignId:'old'};
 const rows=[w('one',{status:'done',legacyPost:{consignment:{stage:'opening'}}}),w('two',{legacyPost:{consignment:{stage:'opening'}}})];
 const stages=campaignLifecycle(project,rows);assert.equal(stages.length,5);assert.equal(stages[0].complete,false);assert.equal(stages[0].state,'current');assert.equal(stages[1].missing,true);assert.equal(campaignLifecycle(p.data,[]),null);
});
test('campaign next action prioritizes blocks and never invents a task',()=>{
 assert.equal(campaignNext(p.data,[w('normal'),w('blocked',{blocked:true,blockedReason:'Needs media'})]).workId,'blocked');assert.equal(campaignNext(p.data,[]).workId,'');assert.match(campaignNext(p.data,[]).text,/first task/);
});
test('calendar ranges handle DST week, leap month and month rollover',()=>{
 assert.deepEqual(calendarWindow('2026-03-08','week'),{from:'2026-03-02',to:'2026-03-08'});assert.deepEqual(calendarWindow('2024-02-20','month'),{from:'2024-02-01',to:'2024-02-29'});assert.equal(moveCalendar('2026-01-31','month',1),'2026-02-01');assert.equal(moveCalendar('2026-03-08','week',1),'2026-03-15');
});
test('reporting sums recorded online and POS values without inventing attribution',()=>{
 assert.deepEqual(reportingSources([]),[]);assert.deepEqual(reportingSources([{date:'2026-03-08',source:'email',campaign:'x',spend:4,onlineRevenue:10,posRevenue:20,onlineOrders:1,posOrders:2,leads:3},{date:'2026-03-09',source:'email',campaign:'x',spend:6,onlineRevenue:5}]),[{source:'email',spend:10,revenue:35,orders:3,leads:3}]);
});

test('all tasks retains unscheduled, unassigned and closed-campaign records',()=>{const rows=[w('unscheduled',{owner:'',productionDue:''}),w('closed',{projectId:'closed'})];assert.equal(taskGroups(rows,[p],'other',chicagoInstant('2026-03-08T12:00'))['All Tasks'].length,2);});
