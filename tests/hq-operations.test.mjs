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
});
after(async()=>{await db?.close();await rm(dir,{recursive:true,force:true});});

async function ops(action,payload={}){return (await db.query('select hub_hq_operations($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
async function notifications(){return (await ops('notification-list')).items;}
async function allNotifications(){return (await db.query('select * from hq_notifications order by id')).rows;}

test('assignment and review notifications persist transactionally and only their recipient can read them',async()=>{
 await actor('owner');await saveProject('p1',project);await actor('maker');let d=await saveDeliverable('d1',deliverable);
 assert.ok((await notifications()).some(n=>n.category==='assignment'&&n.record_id==='d1'));await production('d1','in_progress');await production('d1','needs_review');
 await actor('owner');let n=(await notifications()).find(n=>n.message.startsWith('Review requested'));assert.equal(n.record_id,'d1');await ops('notification-read',{id:n.id,read:true});assert.ok((await notifications()).find(x=>x.id===n.id).read_at);
 await actor('maker');await assert.rejects(ops('notification-read',{id:n.id,read:true}),/recipient/);assert.ok((await allNotifications()).every(x=>x.recipient==='maker'));
 await actor('owner');d=(await hq('review',{id:'d1',version:(await record('deliverable','d1')).version,decision:'approve',comment:'Checked'})).data;
 await actor('maker');assert.ok((await notifications()).some(n=>n.message.startsWith('Approved:')));
 await actor('owner');d=await saveDeliverable('d1',{...deliverableDraft(d),owner:'stranger'},d.version);await actor('maker');assert.ok((await notifications()).some(n=>n.message.startsWith('Reassigned from you')));await actor('stranger');assert.ok((await notifications()).some(n=>n.message.startsWith('Assigned as owner')));
 await actor('foreign');assert.equal((await allNotifications()).length,0);await db.exec('reset role;set role anon');await assert.rejects(ops('notification-list'),/permission denied/);await assert.rejects(db.query('select * from hq_notifications'),/permission denied/);
});

test('mentions validate membership, notify once on retry and do not allow direct inserts',async()=>{
 await actor('maker');const c={id:'p1',kind:'project',commentId:crypto.randomUUID(),body:'Please check the brief',mentions:['owner']};await ops('comment',c);await ops('comment',c);await assert.rejects(ops('comment',{...c,body:'Changed'}),/retry/);
 await assert.rejects(ops('comment',{...c,commentId:crypto.randomUUID(),mentions:['foreign']}),/active people/);await actor('owner');assert.equal((await notifications()).filter(n=>n.category==='mention').length,1);
 await assert.rejects(db.query("insert into hq_notifications(org_id,recipient,event_key,category,kind,record_id,message) values('northside-marketing','owner','forged','mention','project','p1','evil')"),/permission denied/);
});

test('calendar rescheduling changes only the source with CAS, permission checks and approval invalidation',async()=>{
 await actor('maker');let d=await record('deliverable','d1');await assert.rejects(ops('reschedule',{id:'d1',version:1,field:'publishAt',time:'2026-01-14T10:00'}),/Someone changed/);
 await actor('stranger');d=(await ops('reschedule',{id:'d1',version:d.version,field:'productionDue',time:'2026-01-11T11:00'})).data;assert.equal((await record('deliverable','d1')).productionDue,'2026-01-11T11:00');assert.equal(d.approval,null);assert.equal(d.submission,null);
 for(const time of ['2026-03-08T02:30','2026-11-01T01:30'])await assert.rejects(ops('reschedule',{id:'d1',version:d.version,field:'publishAt',time}),/Chicago time/);
 await actor('joey');await assert.rejects(ops('reschedule',{id:'d1',version:d.version,field:'productionDue',time:'2026-01-12T11:00'}),/assigned people/);
 await actor('foreign');await assert.rejects(ops('reschedule',{id:'d1',version:d.version,field:'productionDue',time:''}),/not found/);
});

test('deadline generation uses exact instants, deduplicates, resolves stale reminders and keeps read state',async()=>{
 await actor('owner');await saveDeliverable('reminder',{...deliverable,owner:'maker',productionDue:'2026-03-08T12:00',publishAt:'2026-03-08T14:00'});
 // Only private test execution supplies time. The public RPC always supplies now().
 const generate=async(time)=>{await db.exec('reset role');return (await db.query("select private.hq_reminders('northside-marketing','maker',$1::timestamptz) n",[time])).rows[0].n;};
 assert.equal(await generate('2026-03-07T18:00:00Z'),3,'23h to production across the spring DST change; older work also remains overdue');
 await actor('maker');const first=(await allNotifications()).filter(n=>n.category==='deadline'&&n.record_id==='reminder');assert.equal(first.length,1);assert.match(first[0].message,/approaching/);await ops('notification-read',{id:first[0].id,read:true});
 assert.equal(await generate('2026-03-07T18:00:00Z'),0);await actor('maker');assert.ok((await allNotifications()).find(n=>n.id===first[0].id).read_at);
 await generate('2026-03-08T20:00:00Z');await actor('maker');const after=(await allNotifications()).filter(n=>n.category==='deadline'&&n.record_id==='reminder');assert.ok(after.find(n=>n.id===first[0].id).resolved_at);assert.equal(after.filter(n=>!n.resolved_at&&n.message.includes('missed')).length,3);
 let d=await record('deliverable','reminder');await ops('reschedule',{id:'reminder',version:d.version,field:'productionDue',time:'2026-03-20T10:00'});await generate('2026-03-08T20:00:00Z');await actor('maker');assert.equal((await allNotifications()).filter(n=>n.record_id==='reminder'&&n.metadata.field==='productionDue'&&!n.resolved_at).length,0);
 await assert.rejects(db.query("select private.hq_reminders('northside-marketing','owner',now())"),/permission denied/);
});

test('actual spending permits truthful overspend, separates cost types and never changes approval or allocation',async()=>{
 await actor('owner');const before=await record('project','p1');const a={id:crypto.randomUUID(),projectId:'p1',category:'advertising',amountCents:12500,spentOn:'2026-01-10',channel:'Social',note:'Actual platform invoice'};
 await ops('spend',a);await ops('spend',a);await ops('spend',{...a,id:crypto.randomUUID(),category:'creative',amountCents:4000,note:'Actual designer invoice'});assert.deepEqual(await record('project','p1'),before);
 let summary=(await ops('spend-list',{projectId:'p1'})).summary;assert.deepEqual(summary,{advertisingCents:12500,creativeCents:4000,totalCents:16500});
 await assert.rejects(ops('spend',{...a,amountCents:1}),/retry/);await assert.rejects(ops('spend',{...a,id:crypto.randomUUID(),spentOn:'2099-01-01'}),/future/);
 await actor('maker');await assert.rejects(ops('spend',{...a,id:crypto.randomUUID()}),/project owner/);await actor('admin');await assert.rejects(ops('spend',{...a,id:crypto.randomUUID()}),/project owner/);
 await actor('joey');const reversal={id:crypto.randomUUID(),projectId:'p1',reverses:a.id,note:'Invoice entered twice; reverse the duplicate'};await ops('spend-reverse',reversal);await ops('spend-reverse',reversal);await assert.rejects(ops('spend-reverse',{...reversal,id:crypto.randomUUID()}),/already been reversed/);
 summary=(await ops('spend-list',{projectId:'p1'})).summary;assert.deepEqual(summary,{advertisingCents:0,creativeCents:4000,totalCents:4000});await assert.rejects(db.exec('delete from hq_spend'),/permission denied/);
 await actor('foreign');assert.equal((await db.query('select * from hq_spend')).rows.length,0);await assert.rejects(ops('spend-list',{projectId:'p1'}),/not found/);
});

test('block resolver changes, review changes and confirmed calendar locks remain enforced',async()=>{
 await actor('owner');let d=await saveDeliverable('change-review',{...deliverable,blocked:true,blockedReason:'Confirm details',blockedBy:'stranger'});
 await actor('stranger');assert.ok((await notifications()).some(n=>n.record_id==='change-review'&&n.message.startsWith('Assigned as block resolver')));
 await actor('owner');d=await saveDeliverable('change-review',{...deliverableDraft(d),blockedBy:'owner'},d.version);
 await actor('stranger');assert.ok((await notifications()).some(n=>n.record_id==='change-review'&&n.message.startsWith('Reassigned from you (block resolver)')));
 await actor('owner');await saveDeliverable('change-review',{...deliverableDraft(d),blocked:false,blockedBy:'',blockedReason:''},d.version);
 await actor('maker');await production('change-review','in_progress');await production('change-review','needs_review');
 await actor('owner');await hq('review',{id:'change-review',version:(await record('deliverable','change-review')).version,decision:'changes',comment:'Please revise the caption'});
 await actor('maker');const changes=(await notifications()).find(n=>n.record_id==='change-review'&&n.message.startsWith('Changes requested'));assert.equal(changes.metadata.comment,'Please revise the caption');
 await production('change-review','needs_review');await actor('owner');await hq('review',{id:'change-review',version:(await record('deliverable','change-review')).version,decision:'approve',comment:'Revision checked'});
 await actor('maker');await publish('change-review','facebook','scheduled');d=await record('deliverable','change-review');
 await assert.rejects(ops('reschedule',{id:'change-review',version:d.version,field:'publishAt',time:'2026-01-15T12:00'}),/locked/);
 assert.equal((await record('deliverable','change-review')).publications.instagram.status,'planned');
 for(const input of [{action:'reminders',clockAt:'2099-01-01'}, {action:'spend',id:crypto.randomUUID(),projectId:'p1',category:'advertising',amountCents:-1,spentOn:'2026-01-10',channel:'',note:'Invalid negative'}, {action:'reschedule',id:'d1',version:1,field:'publishedAt',time:'2026-01-10T10:00'}])assert.equal(hqCommand.safeParse(input).success,false);
});

test('notifications, spending and source dates survive restart and migration reapplication',async()=>{
 await db.exec('reset role');const dump=async()=>({notifications:(await db.query('select * from hq_notifications order by id')).rows,spend:(await db.query('select * from hq_spend order by id')).rows,records:(await db.query('select * from marketing_records order by workspace_id,kind,id')).rows});const before=await dump();await db.exec(migration);await db.close();db=new PGlite(dir);assert.deepEqual(await dump(),before);assert.equal(migration,await readFile(new URL('../supabase/migrations/20260919033840_northside_hq_operations.sql',import.meta.url),'utf8'));
});
