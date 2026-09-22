import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,blankDeliverable} from '../lib/hq-model.ts';
import {addDays,budgetTotals,filterSchedule,scheduleRows,todayDashboard} from '../lib/hq-operations.ts';
import {chicagoInstant} from '../lib/consignment.ts';
const meta={version:1,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',createdBy:'owner'};
const project={id:'p',data:{...blankProject,...meta,title:'Launch',brief:'Brief',owner:'owner',members:['maker'],status:'active',budget:null,eventAt:'2026-03-09T12:00',type:'event'}};
const make=(id,patch={})=>({id,data:{...blankDeliverable,...meta,title:id,owner:'maker',projectId:'p',productionDue:'2026-03-08T11:00',publishAt:'2026-03-08T14:00',instructions:'Instructions',format:'Image',caption:'Copy',publisher:'maker',status:'in_progress',approval:null,contentVersion:1,publications:{facebook:{status:'planned'},instagram:{status:'planned'}},...patch}});
const approval={by:'owner',at:'2026-03-01T00:00:00Z',projectVersion:1,budgetVersion:null,approvedVersion:3,contentVersion:1};

test('My Work and Team use actual assignment, approvals, block resolvers and current readiness',()=>{
 const records=[make('overdue'),make('review',{status:'needs_review'}),make('blocked',{blocked:true,blockedBy:'resolver',blockedReason:'Missing source'}),make('ready',{status:'ready',approval}),make('stale',{status:'ready',approval:{...approval,projectVersion:0}}),make('unassigned',{owner:'',publisher:''}),make('done',{publishing:false,platforms:[],status:'done',publications:{}}),make('published',{status:'ready',approval,publications:{facebook:{status:'published',publishedAt:'2026-03-08T10:00'},instagram:{status:'published',publishedAt:'2026-03-08T10:00'}}})];
 const owner=todayDashboard(records,[project],'owner',chicagoInstant('2026-03-08T12:00'));assert.deepEqual(owner.approvals.map(r=>r.id),['review']);assert.equal(owner.dueSoon.length,0);
 const mine=todayDashboard(records,[project],'maker',chicagoInstant('2026-03-08T12:00'));assert.equal(mine.myBlocks.length,0);assert.ok(mine.dueSoon.some(r=>r.id==='overdue'));assert.ok(!mine.dueSoon.some(r=>['ready','done','published'].includes(r.id)));assert.equal(mine.ready.length,2);assert.equal(mine.unassigned.length,1);assert.equal(mine.publishing.filter(r=>r.status==='published').length,2);assert.ok(!mine.unfinished.some(r=>r.status==='published'));
 assert.equal(todayDashboard(records,[project],'resolver',chicagoInstant('2026-03-08T12:00')).myBlocks.length,1);
 const inactive={...project,data:{...project.data,status:'archived'}};assert.equal(todayDashboard(records,[inactive],'maker',chicagoInstant('2026-03-08T12:00')).overdue.length,0);
});

test('Chicago midnight and tomorrow are calendar days across both daylight-saving transitions',()=>{
 assert.equal(addDays('2026-03-08',1),'2026-03-09');assert.equal(addDays('2026-11-01',1),'2026-11-02');
 const rows=[make('before',{publishAt:'2026-03-07T23:30'}),make('today',{publishAt:'2026-03-08T00:30'}),make('tomorrow',{publishAt:'2026-03-09T00:30'})];
 const data=todayDashboard(rows,[project],'maker',Date.parse('2026-03-08T06:15:00Z'));assert.equal(data.day,'2026-03-08');assert.equal(data.tomorrow,'2026-03-09');assert.deepEqual([...new Set(data.myPublishing.map(r=>r.id))],['today']);assert.equal(data.publishing.length,4);
 const fall=todayDashboard([],[],'maker',Date.parse('2026-11-01T05:30:00Z'));assert.equal(fall.day,'2026-11-01');assert.equal(fall.tomorrow,'2026-11-02');
});

test('calendar rows respect actual confirmations and source edits without changing input records',()=>{
 const record=make('dates',{publications:{facebook:{status:'scheduled',scheduledFor:'2026-03-10T10:00'},instagram:{status:'published',publishedAt:'2026-03-07T09:00'}}});const saved=structuredClone(record);
 const rows=scheduleRows([record],[project],'publication');assert.equal(rows.find(r=>r.platform==='facebook').date,'2026-03-10T10:00');assert.equal(rows.find(r=>r.platform==='instagram').status,'published');
 assert.equal(scheduleRows([record],[project],'production')[0].date,record.data.productionDue);assert.deepEqual(record,saved);
 const edited=make('dates',{publishAt:'2026-03-09T15:00'});assert.ok(scheduleRows([edited],[project],'publication').every(r=>r.date===edited.data.publishAt));assert.equal(todayDashboard([edited],[project],'maker',chicagoInstant('2026-03-08T12:00')).publishing[0].date,edited.data.publishAt);
});

test('all calendar filters, missing dates and recurring legacy records retain honest status labels',()=>{
 const records=[make('one'),make('two',{projectId:'',owner:'other',publisher:'',format:'Video',productionDue:'',platforms:['email'],publications:{email:{status:'planned'}}})];
 const legacy=[{id:'series',data:{title:'Tuesday series',date:'2026-03-03T09:00',recurrence:'weekly-tuesday',source:'facebook',status:'approved',caption:''}}];const before=structuredClone(legacy);
 const rows=scheduleRows(records,[project],'publication',legacy,'2026-03-01','2026-03-31');assert.equal(rows.filter(r=>r.recurring).length,5);assert.ok(rows.filter(r=>r.kind==='legacy').every(r=>r.stateLabel==='Legacy approved · unconfirmed'));assert.deepEqual(legacy,before);
 const filters={mode:'publication',person:'maker',project:'p',format:'Image',platform:'facebook',status:'planned',from:'2026-03-01',to:'2026-03-31'};assert.equal(filterSchedule(rows,filters).length,1);
 assert.equal(filterSchedule(rows,{...filters,person:'unassigned',project:'standalone',format:'Video',platform:'email'}).length,1);
 assert.equal(filterSchedule(scheduleRows(records,[project],'production'),{...filters,mode:'production',person:'other',project:'standalone',format:'Video',platform:'',status:''}).length,1,'Missing dates remain actionable');
});

test('project missing inputs do not manufacture unfinished work after deliverables are completed',()=>{
 const ready=make('finished',{publishing:false,status:'done',platforms:[],publications:{}});assert.equal(todayDashboard([ready],[project],'owner',chicagoInstant('2026-03-08T12:00')).missingProjects.length,0);
 assert.ok(todayDashboard([],[project],'owner',chicagoInstant('2026-03-08T12:00')).missingProjects[0].missing.includes('Plan deliverables'));
});

test('budget math keeps plans separate from actuals and flags unapproved spend and overages',()=>{
 const p={...project.data,budget:{amountCents:10000},allocations:[{channel:'Social',amountCents:8000}]};
 let totals=budgetTotals(p,{advertisingCents:6000,creativeCents:2000,totalCents:8000});assert.equal(totals.unallocated,2000);assert.equal(totals.remaining,2000);assert.equal(totals.overage,0,'Actuals must not be added to allocations as if both were costs');
 totals=budgetTotals(p,{advertisingCents:12500,creativeCents:4000,totalCents:16500});assert.equal(totals.remaining,-6500);assert.equal(totals.overage,6500);
 totals=budgetTotals({...p,budget:null},{advertisingCents:1,creativeCents:0,totalCents:1});assert.equal(totals.approved,null);assert.equal(totals.remaining,null);assert.equal(totals.unapprovedSpend,true);
});
