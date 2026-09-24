import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auctionDb} from './helpers/auction-db.mjs';
import {blankProject,projectDraft,projectInput} from '../lib/hq-model.ts';
import {taskInput,canCompleteTask} from '../lib/project-tasks.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
import {checklistWork,checklistGroup,checklistTiming} from '../lib/store-open-work.ts';

const project={...blankProject,title:'Store readiness',brief:'Prepare the store before opening.',owner:'brody',members:['jon'],status:'active',eventAt:'2026-11-20T15:00',storeOpenChecklist:true,department:'Operations',priority:'high'};
const direct={title:'Check front door',instructions:'Test the lock.',projectId:'',assignees:['brody','outsider'],productionDue:'2026-11-19T15:00',endAt:'',priority:'urgent',notes:'Keep the spare key safe.',storeOpenChecklist:true,assets:[],references:['https://example.test/checklist'],assetRoles:{},linkRoles:{}};

test('checklist uses canonical records, normal permissions, shared calendar/assets and retry-safe saves',async t=>{
 const f=await auctionDb(),{db,actor,hq,get}=f;
 const task=async(action,payload)=>(await db.query('select hub_project_tasks($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
 const saveTask=(id,data,version=0)=>task('save-task',{id,data,version});
 const status=async(id,status)=>task('task-status',{id,version:(await get(id)).version,status});
 const records=async()=>(await db.query('select kind,id,data from marketing_records')).rows;
 try {
  await t.test('staff may assign checklist creation to colleagues without broadening ordinary project creation',async()=>{
   await actor('jon');
   await assert.rejects(hq('save-project',{id:'denied-project',version:0,data:{...project,storeOpenChecklist:false}}),/Create your own project/);
   const saved=(await hq('save-project',{id:'opening',version:0,data:project})).data;
   assert.equal(saved.createdBy,'jon');assert.equal(saved.owner,'brody');assert.equal(saved.department,'Operations');
   assert.equal(projectInput.safeParse(projectDraft(saved)).success,true);
   await assert.rejects(hq('save-project',{id:'opening',version:0,data:project}),/Someone changed/);
   await assert.rejects(hq('save-project',{id:'opening',version:saved.version,data:{...project,title:'Member edits owner details'}}),/Only the project owner/);
  });
  await t.test('standalone and project deliverables reuse existing task statuses and staff assignments',async()=>{
   await actor('joey'); // Neither project member nor owner: shared hub permits creation.
   await saveTask('opening-child',{...direct,projectId:'opening',assignees:['outsider'],department:'',initialStatus:'waiting'});
   const d=(await saveTask('opening-direct',direct)).data;
   assert.equal(d.projectId,'');assert.equal(d.approver,'brody');assert.equal(d.workflow,'task');assert.equal(d.publishing,false);
   assert.equal((await get('opening-child')).waiting,true);
   const complete=(await saveTask('already-done',{...direct,initialStatus:'complete'})).data;
   assert.equal(complete.status,'done');assert.ok(complete.completedAt);
   await actor('jon');await status('opening-child','complete'); // Project member, not deliverable assignee.
   await actor('outsider');await status('opening-child','in_progress'); // Individual assignee, not project member.
   await status('opening-direct','complete');
   await actor('joey');await assert.rejects(status('opening-direct','in_progress'),/Only assigned/);
   await assert.rejects(status('opening-child','complete'),/Only assigned/);
   await actor('brody');await status('opening-direct','in_progress');
   assert.equal((await get('opening-direct')).completedAt,undefined);
   await actor('jon');await assert.rejects(saveTask('ordinary-project',{...direct,projectId:'weekly',storeOpenChecklist:undefined,assignees:['outsider']}),/owner or an administrator/);
  });
  await t.test('edits preserve history, status, checklist membership and materials; arbitrary fields cannot bypass managers',async()=>{
   await actor('brody');let d=await get('opening-direct');
   await assert.rejects(saveTask('opening-direct',{...direct,initialStatus:'complete'},d.version),/existing status action/);
   d=(await saveTask('opening-direct',{...direct,department:'Sales',productionDue:'2026-11-18T14:00',notes:'Updated note'},d.version)).data;
   assert.equal(d.status,'in_progress');assert.equal(d.storeOpenChecklist,true);assert.equal(d.department,'Sales');
   const p=await get('opening','project');await hq('save-project',{id:'opening',version:p.version,data:{...projectDraft(p),brief:'Updated through normal editor'}});
   assert.equal((await get('opening','project')).priority,'high');assert.equal((await get('opening','project')).department,'Operations');
   await assert.rejects(saveTask('opening-direct',{...direct,assets:['missing-or-foreign-asset']},d.version),/saved asset/);
   await actor('outsider');await assert.rejects(saveTask('opening-direct',{...direct,title:'Unauthorized'},d.version),/owner or an administrator/);
   assert.ok((await db.query("select count(*) n from hq_activity where record_id='opening-direct'")).rows[0].n>=4);
   assert.equal(Number((await db.query("select count(*) n from marketing_records where kind='deliverable' and id='opening-direct'")).rows[0].n),1);
  });
  await t.test('shared calendar emits one entry per due date with the correct project or direct work link',async()=>{
   await actor('jon');const all=await records(),ps=all.filter(r=>r.kind==='project'),ds=all.filter(r=>r.kind==='deliverable');
   const entries=calendarEntries(ds,ps,[],[],'2026-11-01','2026-11-30');
   const direct=entries.filter(e=>e.key.startsWith('opening-direct:'));assert.equal(direct.length,1);assert.equal(direct[0].href,'/projects/work/opening-direct');assert.equal(direct[0].date,'2026-11-18T14:00');
   const child=entries.filter(e=>e.key.startsWith('opening-child:'));assert.equal(child.length,1);assert.match(child[0].href,/\/projects\/opening\?tab=deliverables&deliverable=opening-child/);
   assert.equal(entries.find(e=>e.key==='openingEvent').title,'Project due');
  });
  await t.test('hub counts and grouping include inherited deliverables once; completed/deleted work remains preserved',async()=>{
   await actor('brody');await saveTask('inherited',{...direct,projectId:'opening',storeOpenChecklist:undefined,department:undefined,productionDue:'2026-11-21T15:00'});
   let m=checklistWork(await records());assert.equal(m.items.length,5);assert.equal(m.completed,1);assert.equal(m.open,4);assert.equal(m.percent,20);
   const inherited=m.items.find(i=>i.record.id==='inherited');assert.equal(checklistGroup(inherited,'department',x=>x),'Operations');assert.equal(checklistGroup(inherited,'owner',x=>x),'brody');assert.equal(checklistTiming(inherited),'After opening');
   const own=m.items.find(i=>i.record.id==='opening-direct');assert.equal(checklistGroup(own,'department',x=>x),'Sales');assert.equal(checklistTiming({...own,due:''}),'No deadline');
   await task('task-delete',{id:'inherited',version:(await get('inherited')).version});m=checklistWork(await records());assert.equal(m.items.length,4);assert.ok((await get('inherited')).deletedAt);
   const p=await get('opening','project');await hq('save-project',{id:'opening',version:p.version,data:{...projectDraft(p),status:'completed'}});
   m=checklistWork(await records());assert.equal(m.completed,2);assert.equal(m.percent,50);
   assert.ok(m.items.find(i=>i.record.id==='opening-child'&&!i.complete)); // Closing parent cannot silently complete its child.
  });
  await t.test('invalid people, organizations, dates and unsigned/anonymous users are rejected',async()=>{
   await actor('jon');
   for(const patch of [{assignees:['foreign']},{assignees:['brody','brody']},{productionDue:'2026-11-01T01:30'},{priority:'bogus'},{department:5},{storeOpenChecklist:'true'},{assets:null},{projectId:'missing'}])await assert.rejects(saveTask('invalid',{...direct,...patch}));
   assert.equal(taskInput.safeParse({...direct,productionDue:'2026-11-01T01:30'}).success,false);assert.equal(taskInput.safeParse({...direct,storeOpenChecklist:false}).success,false);
   await actor('foreign');await assert.rejects(saveTask('foreign',direct),/active staff/);
   await actor('unsigned');await assert.rejects(saveTask('unsigned',direct),/agreement/i);
   await db.exec('reset role;set role anon');await assert.rejects(saveTask('anonymous',direct),/permission denied/);
  });
  await t.test('migration replay changes no records, activity or upload history',async()=>{
   await db.exec('reset role');const snapshot=async()=>({records:(await db.query('select * from marketing_records order by workspace_id,kind,id')).rows,activity:(await db.query('select * from hq_activity order by id')).rows,storage:(await db.query('select * from storage.objects order by name')).rows});
   const helper=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') staff from pg_proc where oid='private.hq_checklist_fields(jsonb)'::regprocedure")).rows[0];assert.equal(helper.prosecdef,false);assert.equal(helper.anon,false);assert.equal(helper.staff,false);assert.ok(helper.proconfig.includes('search_path=\"\"'));
   const before=await snapshot();await db.exec(await readFile(new URL('../supabase/migrations/20260924061808_store_open_work_hub.sql',import.meta.url),'utf8'));assert.deepEqual(await snapshot(),before);
  });
 }finally{await db.close();}
});
