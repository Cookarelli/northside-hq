import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,blankDeliverable} from '../lib/hq-model.ts';
import {storeHasOpened,STORE_OPENING_INSTANT,STORE_OPENED_LABEL,STORE_OPEN_CHECKLIST_HREF,STORE_OPEN_ARCHIVE_HREF} from '../lib/store-opening.ts';
import {projectAreaNavigation,projectAreaTabs,projectAreaAliases,selectedTab} from '../lib/hq-tabs.ts';
import {legacyDestination} from '../lib/hq-navigation.ts';
import {checklistWork} from '../lib/store-open-work.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
import {quickTaskAllowed} from '../lib/hq-presentation.ts';
import {auctionDb} from './helpers/auction-db.mjs';

test('sunset uses the official Chicago instant and retains the checklist route under the archive navigation',()=>{
 assert.equal(STORE_OPENED_LABEL,'Store opened November 20, 2026 at 3:00 PM CST');
 for(const now of [null,Date.parse('2026-11-20T14:59:59-06:00'),STORE_OPENING_INSTANT-1])assert.equal(storeHasOpened(now),false);
 for(const now of [STORE_OPENING_INSTANT,Date.parse('2026-11-20T21:00:00Z'),Date.parse('2027-01-01T00:00:00Z')])assert.equal(storeHasOpened(now),true);
 const before=projectAreaNavigation(false,'store-open-checklist'),after=projectAreaNavigation(true,'store-open-checklist');
 assert.ok(before.tabs.some(t=>t.id==='store-open-checklist'));assert.equal(before.active,'store-open-checklist');
 assert.ok(!after.tabs.some(t=>t.id==='store-open-checklist'));assert.equal(after.active,'archive');assert.ok(after.tabs.some(t=>t.id===after.active));
 assert.equal(projectAreaNavigation(true,'projects').active,'projects');
 for(const requested of ['launch','store-open-checklist'])assert.equal(selectedTab(projectAreaTabs,requested,'projects',projectAreaAliases),'store-open-checklist');
 assert.equal(legacyDestination('#launch'),STORE_OPEN_CHECKLIST_HREF);assert.equal(STORE_OPEN_ARCHIVE_HREF,'/projects?tab=archive');
});

test('archive summary preserves incomplete and manually archived work without changing history or calendar sources',()=>{
 const project=(id,status)=>({kind:'project',id,data:{...blankProject,title:id,storeOpenChecklist:true,owner:'jon',members:['brody'],status,eventAt:'2026-11-20T15:00',assets:['supporting-file'],references:['https://example.test/brief']}});
 const task=(id,patch={})=>({kind:'deliverable',id,data:{...blankDeliverable,title:id,workflow:'task',publishing:false,storeOpenChecklist:true,owner:'brody',contributors:['jon'],notes:'Preserved notes',status:'to_do',productionDue:'2026-11-19T15:00',assets:['supporting-file'],...patch}});
 const records=[project('active','active'),project('done','completed'),project('archived','archived'),task('unfinished',{projectId:'done'}),task('done-child',{projectId:'active',status:'done',completedAt:'2026-11-19T20:00:00Z'}),task('direct'),task('removed',{deletedAt:'2026-11-18T21:00:00Z'}),{kind:'asset',id:'supporting-file',data:{title:'Original document'}},{kind:'plan',id:'launch',data:{address:'Original address',budget:2000}}];
 const original=structuredClone(records),before=checklistWork(records),after=checklistWork(records,{includeArchivedProjects:true});
 assert.equal(before.items.length,5);assert.equal(after.items.length,6);
 assert.deepEqual(after.summary,{totalProjects:3,completedProjects:1,totalDeliverables:3,completedDeliverables:1,remaining:4});
 assert.equal(after.items.find(i=>i.record.id==='unfinished').complete,false,'Completed parent does not complete its child');
 assert.equal(after.items.find(i=>i.record.id==='archived').complete,false,'Archived is not assumed to mean complete');
 assert.ok(after.items.some(i=>i.record.id==='direct'&&!i.complete));
 const entries=calendarEntries(records.filter(r=>r.kind==='deliverable'),records.filter(r=>r.kind==='project'),[],[],'2026-11-01','2026-11-30');
 assert.equal(entries.filter(e=>e.milestone).length,1);assert.ok(entries.some(e=>e.key==='done-child:production'));assert.ok(entries.some(e=>e.key==='archivedEvent'));
 for(let n=0;n<3;n++)checklistWork(records,{includeArchivedProjects:true});
 assert.deepEqual(records,original,'The archive is a read-only projection of the existing records');
 assert.equal(after.items.find(i=>i.record.id==='done-child').record.data.completedAt,'2026-11-19T20:00:00Z');
});

test('remaining work can still be completed using existing assignee permissions, with comments and history preserved',async()=>{
 const f=await auctionDb();
 try{
  await f.actor('jon');
  await f.hq('save-project',{id:'opening',version:0,data:{...blankProject,title:'Store readiness',brief:'Opening work',owner:'jon',members:['brody'],status:'active',eventAt:'2026-11-20T15:00',storeOpenChecklist:true}});
  const task=async(action,payload)=>(await f.db.query('select hub_project_tasks($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
  await task('save-task',{id:'remaining',version:0,data:{title:'Finish handover',instructions:'Keep all history',projectId:'opening',assignees:['jon'],productionDue:'2026-11-21T15:00',endAt:'',priority:'normal',notes:'Original notes',storeOpenChecklist:true,references:['https://example.test/handover'],assets:[],assetRoles:{},linkRoles:{}}});
  await f.hq('comment',{kind:'deliverable',id:'remaining',commentId:crypto.randomUUID(),body:'Original handover discussion'});
  const snapshot=async()=>({records:(await f.db.query('select kind,id,data from marketing_records order by kind,id')).rows,comments:(await f.db.query('select * from hq_comments order by id')).rows,activity:(await f.db.query('select * from hq_activity order by id')).rows,storage:(await f.db.query('select * from storage.objects order by name')).rows});
  const before=await snapshot();
  const archived=checklistWork(before.records,{includeArchivedProjects:storeHasOpened(STORE_OPENING_INSTANT+86400000)});
  assert.equal(archived.summary.remaining,2);assert.deepEqual(await snapshot(),before);
  const p=await f.get('opening','project'),d=await f.get('remaining');
  assert.equal(quickTaskAllowed(d,p,{admin:false,staffId:'brody'}),true);
  assert.equal(quickTaskAllowed(d,p,{admin:false,staffId:'outsider'}),false);
  await f.actor('brody');await task('task-status',{id:'remaining',version:d.version,status:'complete'});
  const done=await f.get('remaining'),after=await snapshot();
  assert.equal(done.status,'done');assert.ok(done.completedAt);assert.equal(done.owner,d.owner);assert.deepEqual(done.contributors,d.contributors);assert.equal(done.notes,d.notes);assert.deepEqual(done.references,d.references);
  assert.deepEqual(after.comments,before.comments);assert.deepEqual(after.storage,before.storage);assert.equal(after.records.length,before.records.length);assert.equal(after.activity.length,before.activity.length+1);
  const previousIds=new Set(before.activity.map(a=>a.id));
  assert.deepEqual(after.activity.filter(a=>previousIds.has(a.id)),before.activity);
  assert.equal(checklistWork(after.records,{includeArchivedProjects:true}).summary.remaining,1);
 }finally{await f.db.close();}
});
