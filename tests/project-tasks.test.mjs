import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {blankProject,blankDeliverable,hqCommand,projectDraft,deliverableDraft} from '../lib/hq-model.ts';

let db,dir,migration;
const actors={joey:'00000000-0000-4000-8000-000000000001',owner:'00000000-0000-4000-8000-000000000002',maker:'00000000-0000-4000-8000-000000000003',stranger:'00000000-0000-4000-8000-000000000004',foreign:'00000000-0000-4000-8000-000000000005',pending:'00000000-0000-4000-8000-000000000006',admin:'00000000-0000-4000-8000-000000000007'};
async function actor(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actors[id]||'']);await db.exec('set role authenticated');}
async function hq(action,payload={}) {return (await db.query('select public.hub_hq($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result;}
async function record(kind,id){return (await db.query('select data from public.marketing_records where kind=$1 and id=$2',[kind,id])).rows[0]?.data;}
async function saveProject(id,data,version=0){return (await hq('save-project',{id,version,data})).data;}
async function saveDeliverable(id,data,version=0){return (await hq('save-deliverable',{id,version,data})).data;}
async function production(id,status){return (await hq('production',{id,version:(await record('deliverable',id)).version,status})).data;}
async function publish(id,platform,status,extra={}) {return (await hq('publication',{id,version:(await record('deliverable',id)).version,platform,status,confirmed:true,time:'2026-01-12T14:00',url:'https://example.test/live',unavailableReason:'',...extra})).data;}
const project={...blankProject,title:'Fictional launch',brief:'Prepare the launch',owner:'owner',members:['maker'],status:'active'};
const deliverable={...blankDeliverable,title:'Fictional announcement',instructions:'Prepare and check the creative',owner:'maker',projectId:'p1',productionDue:'2026-01-10T12:00',publishAt:'2026-01-12T14:00',format:'Image',caption:'Fictional caption',publisher:'maker',requiresFinalFile:false};
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'northside-hq-db-')); db=new PGlite(dir);
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,name text,bucket_id text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 for(const file of ['schema','records','radar','feed','editorial','permissions']) await db.exec(await readFile(new URL('../supabase/'+file+'.sql',import.meta.url),'utf8'));
 for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>/_consignment_(campaigns|preserve_published_history)\.sql$/.test(f)).sort()) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 for(const [id,uid] of Object.entries(actors)) {
  await db.query('insert into auth.users values($1,$2,$3)',[uid,id+'@example.test',id==='pending'?null:'2026-01-01']);
  await db.query('insert into private.staff_access(email,org_id,id,name,role) values($1,$2,$3,$3,$4)',[id+'@example.test',id==='foreign'?'other-org':'northside-marketing',id,['admin'].includes(id)?'admin':'staff']);
 }
 migration=await readFile(new URL('../supabase/migrations/20260919014854_northside_hq_projects_deliverables.sql',import.meta.url),'utf8');await db.exec(migration);
 migration=await readFile(new URL('../supabase/hq-workflow.sql',import.meta.url),'utf8');await db.exec(migration);
 migration=await readFile(new URL('../supabase/hq-operations.sql',import.meta.url),'utf8');await db.exec(migration);
 migration=await readFile(new URL('../supabase/migrations/20260923165617_project_tasks_assignments.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
});
after(async()=>{await db?.close();await rm(dir,{recursive:true,force:true});});

async function ops(action,payload={}){return (await db.query('select hub_hq_operations($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
async function notifications(){return (await ops('notification-list')).items;}
async function allNotifications(){return (await db.query('select * from hq_notifications order by id')).rows;}

async function task(action,payload){return (await db.query('select public.hub_project_tasks($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
const taskData={title:'48 hour reminder graphic',instructions:'Create and hand off the graphic',projectId:'tasks-project',assignees:['maker','stranger'],productionDue:'2026-09-24T09:00',endAt:'',priority:'high',notes:'Use approved imagery'};

test('tasks reuse canonical records, preserve legacy records, notify both assignees, and enforce manager edits',async()=>{
 await actor('owner');await saveProject('tasks-project',{...project,members:['maker','stranger']});
 const legacy=await saveDeliverable('legacy-production',{...deliverable,projectId:'tasks-project'});
 let t=(await task('save-task',{id:'task1',version:0,data:taskData})).data;
 assert.equal(t.owner,'maker');assert.deepEqual(t.contributors,['stranger']);assert.equal(t.workflow,'task');assert.equal(t.priority,'high');
 assert.deepEqual(await record('deliverable','legacy-production'),legacy);
 await actor('maker');assert.ok((await notifications()).some(n=>n.record_id==='task1'));
 await assert.rejects(task('save-task',{id:'task1',version:t.version,data:{...taskData,title:'Unauthorized edit'}}),/owner or an administrator/);
 await assert.rejects(saveDeliverable('task1',{...deliverableDraft(t),instructions:'Bypass task editor'},t.version),/Assigned staff/);
 await actor('stranger');assert.ok((await notifications()).some(n=>n.record_id==='task1'));
 await actor('owner');t=(await task('save-task',{id:'task1',version:t.version,data:{...taskData,productionDue:'2026-09-25T14:00',assignees:['maker']}})).data;
 assert.equal(t.productionDue,'2026-09-25T14:00');assert.deepEqual(t.contributors,[]);
 const count=(await db.query("select count(*) n from public.marketing_records where kind='deliverable' and id='task1'")).rows[0].n;assert.equal(Number(count),1);
 await assert.rejects(task('save-task',{id:'task1',version:1,data:taskData}),/Someone changed/);
 await actor('stranger');await assert.rejects(task('task-status',{id:'task1',version:t.version,status:'complete'}),/Only assigned/);
});
test('assigned staff can wait, complete and reopen; completion time is server owned and history is retained',async()=>{
 await actor('maker');let t=await record('deliverable','task1');
 t=(await task('task-status',{id:'task1',version:t.version,status:'waiting'})).data;assert.equal(t.waiting,true);
 t=(await task('task-status',{id:'task1',version:t.version,status:'complete',completedAt:'1900-01-01'})).data;assert.equal(t.status,'done');assert.ok(Math.abs(Date.now()-Date.parse(t.completedAt))<30000);const completed=t.completedAt;
 t=(await task('task-status',{id:'task1',version:t.version,status:'complete'})).data;assert.equal(t.completedAt,completed);
 t=(await task('task-status',{id:'task1',version:t.version,status:'in_progress'})).data;assert.equal(t.completedAt,undefined);
 assert.ok((await db.query("select count(*) n from hq_activity where record_id='task1'")).rows[0].n>=4);
});
test('delete is recoverable, blocks legacy edits, and clears reminders without removing history',async()=>{
 await actor('owner');let t=await record('deliverable','task1');
 t=(await task('task-delete',{id:'task1',version:t.version})).data;assert.ok(t.deletedAt);assert.ok(await record('deliverable','task1'));
 await assert.rejects(task('task-status',{id:'task1',version:t.version,status:'complete'}),/Restore/);
 await assert.rejects(ops('reschedule',{id:'task1',version:t.version,field:'productionDue',time:'2026-09-26T10:00'}),/Restore/);
 await actor('maker');await ops('reminders');assert.ok(!(await notifications()).some(n=>n.record_id==='task1'&&n.category==='deadline'&&!n.resolved_at));
 await assert.rejects(task('task-restore',{id:'task1',version:t.version}),/owner or an administrator/);
 await actor('owner');t=(await task('task-restore',{id:'task1',version:t.version})).data;assert.equal(t.deletedAt,undefined);assert.equal(t.productionDue,'2026-09-25T14:00');
});
test('foreign, inactive, unconfirmed, anonymous, and invalid-date requests cannot write tasks',async()=>{
 await actor('foreign');await assert.rejects(task('save-task',{id:'x',version:0,data:taskData}),/owner or an administrator/);
 await actor('pending');await assert.rejects(task('save-task',{id:'x',version:0,data:taskData}),/Staff access/);
 await actor('owner');
 for(const patch of [{assignees:['foreign']},{assignees:['maker','maker']},{productionDue:'2026-03-08T02:30'},{productionDue:'2026-11-01T01:30'},{endAt:'2026-01-01T10:00'},{priority:'bogus'}]) await assert.rejects(task('save-task',{id:'invalid',version:0,data:{...taskData,...patch}}));
 await db.exec('reset role;set role anon');await assert.rejects(task('save-task',{id:'x',version:0,data:taskData}),/permission denied/);
});
test('publishing workflow cannot be converted or marked complete by the task endpoint',async()=>{
 await actor('owner');const d=await record('deliverable','legacy-production');
 await assert.rejects(task('save-task',{id:'legacy-production',version:d.version,data:taskData}),/Publishing work keeps/);
 await assert.rejects(task('task-status',{id:'legacy-production',version:d.version,status:'complete'}),/Only assigned/);
 const updated=(await task('task-metadata',{id:'legacy-production',version:d.version,data:{priority:'urgent',notes:'Check copy'}})).data;
 assert.equal(updated.priority,'urgent');assert.equal(updated.status,d.status);assert.equal(updated.completedAt,undefined);
});

// Replay against populated data proves the additive migration never rewrites history.
test('migration replay preserves records, notifications and activity; new projects require an owner',async()=>{
 await db.exec('reset role');
 const snapshot=async()=>({records:(await db.query('select * from marketing_records order by workspace_id,kind,id')).rows,activity:(await db.query('select * from hq_activity order by id')).rows,notifications:(await db.query('select * from hq_notifications order by id')).rows});
 const before=await snapshot();await db.exec(migration);assert.deepEqual(await snapshot(),before);
 await actor('owner');await assert.rejects(saveProject('unowned',{...project,owner:'',status:'draft'}),/primary project owner/);
 const p=await record('project','tasks-project');await assert.rejects(saveProject('tasks-project',{...projectDraft(p),owner:'',status:'draft'},p.version),/primary project owner/);
});
test('inactive staff cannot work or be assigned, and project members can add only self-assigned tasks',async()=>{
 await db.exec('reset role');await db.exec("update private.staff_access set active=false where id='stranger'");
 await actor('stranger');await assert.rejects(task('save-task',{id:'inactive',version:0,data:taskData}),/Staff access/);
 await actor('owner');await assert.rejects(task('save-task',{id:'inactive',version:0,data:taskData}),/active staff/);
 await actor('maker');const own=(await task('save-task',{id:'self-task',version:0,data:{...taskData,assignees:['maker']}})).data;assert.equal(own.owner,'maker');
 await assert.rejects(task('save-task',{id:'assign-others',version:0,data:{...taskData,assignees:['owner']}}),/owner or an administrator/);
});

test('workflow audit: rescheduling replaces active reminders and completion stops them for assigned staff',async()=>{
 const {chicagoWall}=await import('../lib/consignment.ts');
 const due=chicagoWall(Date.now()+3600000).slice(0,16),later=chicagoWall(Date.now()+7200000).slice(0,16);
 await actor('owner');await saveProject('audit-project',{...project,title:'Workflow audit',members:['maker']});
 let d=(await task('save-task',{id:'audit-task',version:0,data:{...taskData,projectId:'audit-project',assignees:['maker'],productionDue:due}})).data;
 await actor('maker');await ops('reminders');await ops('reminders');
 let active=(await notifications()).filter(n=>n.record_id==='audit-task'&&n.category==='deadline'&&!n.resolved_at);
 assert.equal(active.length,1);assert.equal(active[0].metadata.dueAt,due);
 await actor('owner');d=(await task('save-task',{id:'audit-task',version:d.version,data:{...taskData,projectId:'audit-project',assignees:['maker'],productionDue:later}})).data;
 await actor('maker');await ops('reminders');
 active=(await notifications()).filter(n=>n.record_id==='audit-task'&&n.category==='deadline'&&!n.resolved_at);
 assert.equal(active.length,1);assert.equal(active[0].metadata.dueAt,later);
 assert.ok((await notifications()).some(n=>n.record_id==='audit-task'&&n.metadata.dueAt===due&&n.resolved_at));
 await task('task-status',{id:'audit-task',version:d.version,status:'complete'});await ops('reminders');
 assert.equal((await notifications()).filter(n=>n.record_id==='audit-task'&&n.category==='deadline'&&!n.resolved_at).length,0);
 assert.equal((await record('deliverable','audit-task')).status,'done');
 assert.equal(Number((await db.query("select count(*) n from marketing_records where kind='deliverable' and id='audit-task'")).rows[0].n),1);
});
