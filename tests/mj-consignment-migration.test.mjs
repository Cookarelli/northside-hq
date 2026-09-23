import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {blankProject,blankDeliverable} from '../lib/hq-model.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
import {calendarTime} from '../lib/content-calendar.ts';

const migrationName='20260923204847_mj_consignment_deliverables.sql';
const migration=await readFile(new URL('../supabase/migrations/'+migrationName,import.meta.url),'utf8');
const sourceId='mj-consignment-video-2026-09-23',parentId='existing-weekly-project';
let db;
const metadata={version:3,createdBy:'steve',createdAt:'2026-09-23T13:30:26Z',updatedAt:'2026-09-23T13:49:42Z'};
const source={...blankProject,...metadata,title:'Michael Jordan Consignment Video Campaign',type:'weekly_auction',owner:'steve',members:['brody','jon'],brief:'Shared hero video brief',notes:'Keep the original footage',auctionClosesAt:'2026-09-27T21:00:00-05:00',assets:['hero'],references:['https://example.test/reference'],assetRoles:{hero:'reference'},auction:{auctionPlatform:'Collect',batchUrl:'https://example.test/mj-auction',cards:[{name:'MJ',url:'https://example.test/mj-lot'}]},customMetadata:{keep:'everything'}};
const parent={...blankProject,...metadata,title:'Collect Weekly Auction',type:'weekly_auction',owner:'joey',members:['jon','brody','steve'],status:'active',brief:'Existing LeBron brief',auctionClosesAt:'2026-09-26T21:30',references:['https://example.test/lebron'],budget:{amountCents:30000,currency:'USD',version:1},allocations:[{channel:'Facebook',amountCents:25000}]};
const reminder=hours=>({...blankDeliverable,...metadata,contentVersion:2,title:'Old '+hours+'h reminder',owner:'jon',contributors:['steve','brody'],projectId:sourceId,status:'to_do',instructions:'Unique '+hours+'h cut',notes:'Existing '+hours+'h notes',publisher:'steve',publishAt:'2026-01-01T12:00',assets:['draft'],assetRoles:{draft:'draft'},references:['https://example.test/creative'],linkRoles:{'https://example.test/creative':'draft'},publications:{facebook:{status:'planned'},instagram:{status:'planned'}},approval:null,customMetadata:{hours}});
async function put(kind,id,data){await db.query('insert into marketing_records(workspace_id,kind,id,data) values($1,$2,$3,$4)', ['northside-marketing',kind,id,JSON.stringify(data)]);}
async function get(kind,id){return (await db.query('select data from marketing_records where workspace_id=$1 and kind=$2 and id=$3',['northside-marketing',kind,id])).rows[0]?.data;}
async function snapshot(){return {records:(await db.query('select * from marketing_records order by workspace_id,kind,id')).rows,comments:(await db.query('select * from hq_comments order by id')).rows,activity:(await db.query('select * from hq_activity order by id')).rows,notifications:(await db.query('select * from hq_notifications order by id')).rows};}
async function clear(){await db.exec('truncate marketing_records,hq_activity,hq_comments,hq_notifications');}
async function seed({close=source.auctionClosesAt,parentClose=parent.auctionClosesAt,existing=true}={}){
 await clear();await put('project',parentId,{...parent,auctionClosesAt:parentClose});await put('project',sourceId,{...source,auctionClosesAt:close});
 for(const id of ['hero','draft'])await put('asset',id,{name:id,key:'preserved/'+id,metadata:{original:true}});
 if(existing)for(const hours of [48,24,2])await put('deliverable','mj-consignment-video-'+hours+'h',reminder(hours));
 await put('deliverable','unrelated',{...reminder(1),projectId:parentId,title:'LeBron work'});
 await db.exec("insert into hq_comments(org_id,id,kind,record_id,actor,body) values('northside-marketing','40000000-0000-4000-8000-000000000001','project','mj-consignment-video-2026-09-23','steve','Original discussion')");
}
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,name text,bucket_id text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;
 create schema cron;create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,active boolean default true);
 create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(name,schedule,command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid$$;`);
 for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f<migrationName).sort()) {
  const sql=(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')).replace('create extension if not exists pg_cron with schema pg_catalog;','');
  await db.exec(sql);
 }
 for(const id of ['steve','jon','brody','joey'])await db.query('insert into private.staff_access(email,org_id,id,name,role) values($1,$2,$3,$3,$4)',[id+'@example.test','northside-marketing',id,id==='steve'?'admin':'staff']);
});
after(async()=>await db?.close());

test('moves the existing three IDs, calculates Chicago times and preserves all useful data and parent work',async()=>{
 await seed();const before=await snapshot();await db.exec(migration);
 assert.equal((await db.query("select count(*) n from marketing_records where kind='project'")).rows[0].n,2);
 const expected={48:'2026-09-25T21:00',24:'2026-09-26T21:00',2:'2026-09-27T19:00'};
 for(const hours of [48,24,2]){
  const d=await get('deliverable','mj-consignment-video-'+hours+'h'),old=reminder(hours);
  assert.equal(d.title,`Michael Jordan Auction — ${hours} Hour Reminder`);assert.equal(d.projectId,parentId);
  assert.equal(d.productionDue,expected[hours]);assert.equal(d.publishAt,expected[hours]);assert.equal(d.campaignReference,'Michael Jordan Consignment');
  for(const key of ['owner','contributors','publisher','instructions','publications','createdAt','createdBy','status','customMetadata'])assert.deepEqual(d[key],old[key],key);
  assert.deepEqual(d.assets,['draft','hero']);assert.deepEqual(d.references,['https://example.test/creative','https://example.test/reference']);
  assert.deepEqual(d.assetRoles,{draft:'draft',hero:'reference'});assert.equal(d.destinationUrl,'https://example.test/mj-auction');
  assert.equal(d.campaignAuction.cards[0].url,'https://example.test/mj-lot');assert.equal(d.campaignBrief,source.brief);
  assert.equal(d.notes,old.notes+'\n\n'+source.notes);assert.equal(d.priority,'normal');assert.ok(Date.parse(d.updatedAt)>Date.parse(old.updatedAt));
  assert.deepEqual(d.campaignMigration.previousDeliverable,old);assert.deepEqual(d.campaignMigration.sourceProject,source);
 }
 const p=await get('project',parentId);for(const key of Object.keys(parent).filter(k=>!['title','version','updatedAt'].includes(k)))assert.deepEqual(p[key],parent[key],key);
 assert.equal(p.title,'Collect Weekly Auctions');const archived=await get('project',sourceId);assert.equal(archived.status,'archived');assert.equal(archived.migratedToProjectId,parentId);assert.deepEqual(archived.migrationSnapshot,source);
 const after=await snapshot();assert.deepEqual(after.comments,before.comments);
 for(const row of before.records.filter(r=>r.kind==='asset'||r.id==='unrelated'))assert.deepEqual(after.records.find(r=>r.id===row.id),row);
 const records=after.records.filter(r=>r.kind==='deliverable'),projects=after.records.filter(r=>r.kind==='project');
 const entries=calendarEntries(records,projects,[],[],'2026-09-25','2026-09-27');
 assert.equal(entries.filter(e=>e.key.endsWith(':production')).length,3);assert.ok(!entries.some(e=>e.href==='/projects/'+sourceId));
 assert.equal(calendarTime(expected[2]),'7:00 p.m. CT');
 const saved=await snapshot();await db.exec(migration);assert.deepEqual(await snapshot(),saved,'Replay cannot change records or append duplicate history/notifications');
});

test('migration guard stops old seed logic from reactivating the project or moving work back',async()=>{
 await assert.rejects(db.query("update marketing_records set data=jsonb_set(data,'{status}','\"active\"') where kind='project' and id=$1",[sourceId]),/migrated/);
 await assert.rejects(db.query("update marketing_records set data=jsonb_set(data,'{projectId}',to_jsonb($1::text)) where kind='deliverable' and id='mj-consignment-video-48h'",[sourceId]),/migrated/);
 await assert.rejects(put('deliverable','new-old-campaign-item',reminder(3)),/migrated/);
 await db.exec('set role anon');await assert.rejects(db.query('select * from marketing_records'),/permission denied/);await db.exec('reset role');
});

test('uses exact close across DST with elapsed 48/24/2 hours, independent of database timezone',async()=>{
 await seed({close:'2026-11-01T21:30:00-06:00'});await db.exec("set timezone='Asia/Tokyo'");await db.exec(migration);
 assert.equal((await get('deliverable','mj-consignment-video-48h')).publishAt,'2026-10-30T22:30');
 assert.equal((await get('deliverable','mj-consignment-video-24h')).publishAt,'2026-10-31T22:30');
 assert.equal((await get('deliverable','mj-consignment-video-2h')).publishAt,'2026-11-01T19:30');
 await db.exec("set timezone='UTC'");
});

test('creates missing canonical reminders once and uses the saved parent close when the campaign has none',async()=>{
 await seed({close:'',parentClose:'2026-09-27T21:45',existing:false});await db.exec(migration);
 assert.equal((await get('deliverable','mj-consignment-video-48h')).publishAt,'2026-09-25T21:45');
 const before=await snapshot();await db.exec(migration);assert.deepEqual(await snapshot(),before);
 assert.equal((await db.query("select count(*) n from marketing_records where kind='deliverable' and data->>'campaignReference'='Michael Jordan Consignment'")).rows[0].n,3);
});

test('fallback uses Friday/Saturday 9 PM and Sunday 7 PM from the campaign week without hardcoded dates',async()=>{
 await seed({close:'',parentClose:''});await db.exec(migration);
 assert.equal((await get('deliverable','mj-consignment-video-48h')).publishAt,'2026-09-25T21:00');
 assert.equal((await get('deliverable','mj-consignment-video-24h')).publishAt,'2026-09-26T21:00');
 assert.equal((await get('deliverable','mj-consignment-video-2h')).publishAt,'2026-09-27T19:00');
 assert.equal((await get('deliverable','mj-consignment-video-2h')).campaignMigration.closeWasInferred,true);
 await seed({close:'',parentClose:''});await db.query("update marketing_records set data=jsonb_set(data,'{createdAt}','\"2026-10-28T13:00:00Z\"') where id=$1",[sourceId]);await db.exec(migration);
 assert.equal((await get('deliverable','mj-consignment-video-48h')).publishAt,'2026-10-30T21:00');
 assert.equal((await get('deliverable','mj-consignment-video-24h')).publishAt,'2026-10-31T21:00');
 assert.equal((await get('deliverable','mj-consignment-video-2h')).publishAt,'2026-11-01T19:00');
});

test('missing/ambiguous parents and confirmed publication abort atomically; absent campaigns are a no-op',async()=>{
 await seed();await put('project','ambiguous',{...parent,title:'Collect Weekly Auctions'});let before=await snapshot();
 await assert.rejects(db.exec(migration),/exactly one/);await db.exec('rollback');assert.deepEqual(await snapshot(),before);
 await seed();await db.query("update marketing_records set data=jsonb_set(data,'{publications,facebook,status}','\"published\"') where id='mj-consignment-video-24h'");before=await snapshot();
 await assert.rejects(db.exec(migration),/requires review/);await db.exec('rollback');assert.deepEqual(await snapshot(),before);
 await clear();await put('project',sourceId,source);before=await snapshot();await assert.rejects(db.exec(migration),/exactly one/);await db.exec('rollback');assert.deepEqual(await snapshot(),before);
 await clear();await put('project',parentId,parent);before=await snapshot();await db.exec(migration);assert.deepEqual(await snapshot(),before);
});
