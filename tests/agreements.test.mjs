import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;
const uid='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const doc='20000000-0000-4000-8000-000000000001';
const hardening=()=>readFile(new URL('../supabase/migrations/20260922181627_employee_agreement_safe_reconciliation.sql',import.meta.url),'utf8');
async function actor(id=uid){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function gate(){return (await db.query('select hub_agreement_gate() result')).rows[0].result;}
async function accept(name='Test Employee'){return (await db.query('select hub_accept_agreement($1,$2,$3,$4) result',[doc,name,'','local-test'])).rows[0].result;}
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f<'20260922101800').sort())await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.query("insert into auth.users values($1,'employee@example.test',now()),($2,'other@example.test',now())",[uid,other]);
 await db.exec("insert into private.staff_access(email,org_id,id,name,role) values('employee@example.test','northside-marketing','test','Test Employee','staff'),('other@example.test','other-workspace','other','Other Employee','staff');insert into marketing_records values('northside-marketing','plan','preserved','{\"original\":true}',now());");
 const before=(await db.query('select * from marketing_records')).rows;
 await db.exec('begin');
 await db.exec(await readFile(new URL('../supabase/migrations/20260922101800_employee_agreements.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20260922113000_employee_agreements_immediate_gate.sql',import.meta.url),'utf8'));
 await db.exec(await hardening());await db.exec('commit');
 await db.exec(await readFile(new URL('../supabase/migrations/20260923165617_project_tasks_assignments.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select * from marketing_records')).rows,before);
});
after(async()=>await db?.close());
test('missing configuration fails closed; identity stays available; operational RPC and reads are blocked',async()=>{
 await actor();await assert.rejects(gate(),/setup required/);
 assert.equal((await db.query('select hub_context() result')).rows[0].result.orgId,'northside-marketing');
 await assert.rejects(db.query("select hub_save_record('plan','bypass','{}')"),/signature required/);
 assert.equal((await db.query('select * from marketing_records')).rows.length,0);
 await db.exec('reset role');
 await db.query("insert into private.agreement_documents(id,org_id,version,title,storage_path,document_hash,effective_date,active) values($1,'northside-marketing','local-test','Local test agreement','northside/test.pdf',repeat('a',64),current_date-1,true)",[doc]);
 await db.exec("insert into storage.objects values(gen_random_uuid(),'northside/test.pdf','employee-agreements','{}')");
});
test('immediate hard gate ignores deferred dates and allows only the controlled PDF',async()=>{
 await actor();let g=await gate();assert.equal(g.required,true);assert.equal(g.hardGate,true);
 assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 await assert.rejects(db.query('select * from private.agreement_documents'),/permission denied/);
 await db.exec('reset role');await db.exec("update private.agreement_assignments set deferred_until=now()+interval '30 days',review_due_at=now()+interval '30 days'");
 await actor();g=await gate();assert.equal(g.required,true);assert.equal(g.hardGate,true);
 assert.equal((await db.query("select to_regprocedure('public.hub_defer_agreement(uuid)') f")).rows[0].f,null);
 await assert.rejects(accept('Not the staff name'),/full name/);
 await assert.rejects(db.query("select hub_hq('context','{}')"),/signature required/);
 await assert.rejects(db.query("select hub_project_tasks('save-task','{}')"),/signature required/);
});
test('acceptance uses server identity/time, is idempotent and releases access',async()=>{
 await actor();const start=Date.now();const first=await accept();assert.ok(new Date(first.acceptedAt).getTime()>=start-1000);const retry=await accept();assert.equal(retry.acceptedAt,first.acceptedAt);
 assert.equal((await gate()).required,false);
 assert.equal((await db.query('select * from marketing_records')).rows.length,1);
 for(const sql of ['select * from private.agreement_acceptances',"update private.agreement_acceptances set full_name='Forged'",'delete from private.agreement_acceptances',"insert into private.agreement_acceptances(agreement_id,user_id,staff_id,full_name,email) values(gen_random_uuid(),gen_random_uuid(),'bad','bad','bad')"])await assert.rejects(db.query(sql),/permission denied/);
 await db.exec('reset role');const rows=(await db.query('select * from private.agreement_acceptances')).rows;assert.equal(rows.length,1);assert.equal(rows[0].user_id,uid);assert.equal(rows[0].full_name,'Test Employee');assert.equal(rows[0].document_hash,'a'.repeat(64));assert.equal(rows[0].accepted_at.toISOString(),new Date(first.acceptedAt).toISOString());
 await assert.rejects(db.query("update private.agreement_acceptances set accepted_at=now()"),/immutable/);await assert.rejects(db.query('delete from private.agreement_acceptances'),/immutable/);
 await assert.rejects(db.query("update private.agreement_documents set document_hash=repeat('b',64)"),/immutable/);
 await db.exec(await hardening());assert.deepEqual((await db.query('select * from private.agreement_acceptances')).rows,rows);
});
test('a new version requires acceptance while preserving the prior signature across sessions',async()=>{
 await actor();assert.equal((await gate()).required,false);
 await db.exec('reset role');
 const original=(await db.query('select * from private.agreement_acceptances')).rows;
 const nextDoc='20000000-0000-4000-8000-000000000002';
 await db.query("insert into private.agreement_documents(id,org_id,version,title,storage_path,document_hash,effective_date,active) values($1,'northside-marketing','local-test-v2','Updated local test agreement','northside/test-v2.pdf',repeat('b',64),current_date-1,true)",[nextDoc]);
 await actor();const pending=await gate();assert.equal(pending.required,true);assert.equal(pending.agreementId,nextDoc);
 await assert.rejects(db.query("select hub_hq('context','{}')"),/signature required/);
 await assert.rejects(db.query("select hub_project_tasks('save-task','{}')"),/signature required/);
 await db.query('select hub_accept_agreement($1,$2,$3,$4)',[nextDoc,'Test Employee','127.0.0.1','version-test']);
 await actor();assert.equal((await gate()).required,false);
 await db.exec('reset role');
 assert.deepEqual((await db.query('select * from private.agreement_acceptances where agreement_id=$1',[doc])).rows,original);
 const next=(await db.query('select * from private.agreement_acceptances where agreement_id=$1',[nextDoc])).rows;
 assert.equal(next.length,1);assert.equal(next[0].document_hash,'b'.repeat(64));assert.equal(next[0].user_agent,'version-test');assert.equal(next[0].ip_address,'127.0.0.1');
});
test('foreign staff, disabled staff and anonymous sessions cannot sign or access documents',async()=>{
 await actor(other);await assert.rejects(accept('Other Employee'),/unavailable/);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await db.exec("reset role;update private.staff_access set active=false where id='test'");await actor();await assert.rejects(gate(),/Staff access required/);
 await actor('');await assert.rejects(gate(),/Staff access required/);
 await db.exec('reset role;set role anon');await assert.rejects(gate(),/permission denied/);await assert.rejects(accept(),/permission denied/);
});
