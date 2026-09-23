import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {blankProject} from '../lib/hq-model.ts';
import {chicagoWall} from '../lib/consignment.ts';
let db,migration;
const ids={manager:'10000000-0000-4000-8000-000000000001',maker:'10000000-0000-4000-8000-000000000002',unsigned:'10000000-0000-4000-8000-000000000003',disabled:'10000000-0000-4000-8000-000000000004',unverified:'10000000-0000-4000-8000-000000000005'};
const doc='20000000-0000-4000-8000-000000000001';
async function actor(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[id]||'']);await db.exec('set role authenticated');}
async function background(){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");return (await db.query('select private.hq_refresh_reminders() result')).rows[0].result;}
async function task(action,payload){return (await db.query('select hub_project_tasks($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
const input={title:'Background reminder test',instructions:'Prepare the work',projectId:'p',assignees:['maker'],productionDue:chicagoWall(Date.now()+4*3600000),endAt:'',priority:'normal',notes:''};
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;
 create schema cron;create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,active boolean default true);
 create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(name,schedule,command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid$$;`);
 for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f<'20260923184209').sort())await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 for(const [id,uid] of Object.entries(ids)){
  await db.query('insert into auth.users values($1,$2,$3)',[uid,id+'@example.test',id==='unverified'?null:new Date().toISOString()]);
  await db.query('insert into private.staff_access(email,org_id,id,name,role) values($1,$2,$3,$3,$4)',[id+'@example.test','northside-marketing',id,id==='manager'?'admin':'staff']);
 }
 await db.query("insert into private.agreement_documents(id,org_id,version,title,storage_path,document_hash,effective_date,active) values($1,'northside-marketing','background-test','Test agreement','northside/test.pdf',repeat('a',64),current_date-1,true)",[doc]);
 await db.exec("insert into storage.objects values(gen_random_uuid(),'northside/test.pdf','employee-agreements','{}')");
 for(const id of ['manager','maker','disabled']){await actor(id);await db.query('select hub_agreement_gate()');await db.query('select hub_accept_agreement($1,$2,$3,$4)',[doc,id,'','test']);}
 await actor('manager');await db.query("select hub_hq('save-project',$1)",[JSON.stringify({id:'p',version:0,data:{...blankProject,title:'Scheduled work',brief:'Prepare the deliverables',owner:'manager',members:['maker','unsigned','disabled','unverified'],status:'active'}})]);
 await task('save-task',{id:'work',version:0,data:input});
 await task('save-task',{id:'other',version:0,data:{...input,title:'Gated work',assignees:['unsigned','disabled','unverified']}});
 await db.exec("reset role;update private.staff_access set active=false where id='disabled'");
 // PGlite has no cron worker. Only extension installation is replaced; production SQL runs unchanged.
 migration=(await readFile(new URL('../supabase/migrations/20260923184209_hq_background_reminders.sql',import.meta.url),'utf8')).replace('create extension if not exists pg_cron with schema pg_catalog;','');
 migration+=await readFile(new URL('../supabase/migrations/20260923184345_hq_reminder_status_boundary.sql',import.meta.url),'utf8');
 await db.exec(migration);
});
after(async()=>await db?.close());

test('scheduled invocation without a login creates assigned reminders, is idempotent, and preserves source records',async()=>{
 const before=(await db.query('select kind,id,data from marketing_records order by kind,id')).rows;
 const first=await background();assert.equal(first.failures,0);assert.equal(first.checked,2);assert.ok(first.inserted>0);
 assert.equal((await background()).inserted,0);
 const rows=(await db.query("select recipient,record_id from hq_notifications where category='deadline' and resolved_at is null")).rows;
 assert.ok(rows.some(r=>r.recipient==='maker'&&r.record_id==='work'));
 assert.ok(!rows.some(r=>['unsigned','disabled','unverified'].includes(r.recipient)));
 assert.deepEqual((await db.query('select kind,id,data from marketing_records order by kind,id')).rows,before);
 await db.exec(migration);assert.equal((await db.query('select count(*) n from cron.job')).rows[0].n,1);
 assert.equal((await db.query('select schedule from cron.job')).rows[0].schedule,'*/5 * * * *');
});

test('rescheduling, completion and recoverable deletion resolve background reminders without duplicate events',async()=>{
 await actor('manager');await task('save-task',{id:'work',version:1,data:{...input,productionDue:chicagoWall(Date.now()+8*3600000)}});
 await background();let rows=(await db.query("select * from hq_notifications where category='deadline' and record_id='work'")).rows;
 assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.resolved_at===null).length,1);
 await actor('maker');await task('task-status',{id:'work',version:2,status:'complete'});await background();
 assert.equal((await db.query("select count(*) n from hq_notifications where category='deadline' and record_id='work' and resolved_at is null")).rows[0].n,0);
 await actor('manager');await task('save-task',{id:'remove',version:0,data:input});await background();
 await actor('manager');await task('task-delete',{id:'remove',version:1});await background();
 assert.equal((await db.query("select count(*) n from hq_notifications where category='deadline' and record_id='remove' and resolved_at is null")).rows[0].n,0);
});

test('status is gated, reflects a stale or disabled scheduler, and never enables email or exposes worker access',async()=>{
 await actor('maker');let status=(await db.query('select hub_reminder_status() result')).rows[0].result;
 assert.equal(status.active,true);assert.equal(status.emailEnabled,false);
 await assert.rejects(db.query('select private.hq_refresh_reminders()'),/permission denied/);
 await assert.rejects(db.query('select * from private.hq_reminder_runs'),/permission denied/);
 await actor('unsigned');await assert.rejects(db.query('select hub_reminder_status()'),/signature required/);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select hub_reminder_status()'),/permission denied/);
 await db.exec("reset role;update private.hq_reminder_runs set completed_at=now()-interval '20 minutes'");
 await actor('maker');assert.equal((await db.query('select hub_reminder_status() result')).rows[0].result.active,false);
 await background();await db.exec('update cron.job set active=false');await actor('maker');assert.equal((await db.query('select hub_reminder_status() result')).rows[0].result.active,false);
});

test('background scheduling reads legacy offset timestamps in Chicago and retains DST validation',async()=>{
 await db.exec('reset role');
 for(const [input,expected] of [['2026-09-27T21:00:00-05:00','2026-09-27T21:00'],['2026-09-28T02:00:00Z','2026-09-27T21:00'],['2026-01-28T02:00:00Z','2026-01-27T20:00'],['2026-03-08T02:30',''],['2026-11-01T01:30',''],['invalid','']])
  assert.equal((await db.query('select private.hq_time($1) value',[input])).rows[0].value,expected);
});
