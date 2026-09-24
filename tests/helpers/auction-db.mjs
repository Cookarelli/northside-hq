import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {blankProject,blankDeliverable} from '../../lib/hq-model.ts';

export async function auctionDb({numbered=false}={}){
 const db=new PGlite(),actors=Object.fromEntries(['joey','steve','jon','brody','outsider','foreign','unsigned'].map((name,index)=>[name,`10000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`]));
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,name text,bucket_id text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;
 create schema cron;create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,active boolean default true);
 create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(name,schedule,command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid$$;`);
 const directory=new URL('../../supabase/migrations/',import.meta.url);
 for(const file of (await readdir(directory)).sort())await db.exec((await readFile(new URL(file,directory),'utf8')).replace('create extension if not exists pg_cron with schema pg_catalog;',''));
 for(const [name,uid] of Object.entries(actors)){
  await db.query('insert into auth.users values($1,$2,now())',[uid,name+'@example.test']);
  await db.query('insert into private.staff_access(email,org_id,id,name,role) values($1,$2,$3,$4,$5)',[name+'@example.test',name==='foreign'?'other-org':'northside-marketing',name,name[0].toUpperCase()+name.slice(1),name==='steve'?'admin':'staff']);
 }
 async function actor(name){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actors[name]||'']);await db.exec('set role authenticated');}
 async function hq(action,payload={}){return (await db.query('select hub_hq($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
 async function get(id,kind='deliverable'){return (await db.query('select data from marketing_records where kind=$1 and id=$2',[kind,id])).rows[0]?.data;}
 async function save(payload){return (await db.query('select hub_auction_deliverable($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;}
 const doc='20000000-0000-4000-8000-000000000001';
 for(const org of ['northside-marketing','other-org'])await db.query("insert into private.agreement_documents(id,org_id,version,title,storage_path,document_hash,effective_date,active) values($1,$2,'auction-test','Test agreement',$3,repeat('a',64),current_date-1,true)",[org==='northside-marketing'?doc:'20000000-0000-4000-8000-000000000002',org,org+'/test.pdf']);
 await db.exec("insert into storage.objects values(gen_random_uuid(),'northside-marketing/test.pdf','employee-agreements','{}'),(gen_random_uuid(),'other-org/test.pdf','employee-agreements','{}')");
 for(const name of Object.keys(actors).filter(name=>name!=='unsigned')){await actor(name);await db.query('select hub_agreement_gate()');await db.query('select hub_accept_agreement($1,$2,$3,$4)',[name==='foreign'?'20000000-0000-4000-8000-000000000002':doc,name,'','test']);}
 await actor('steve');
 await hq('save-project',{id:'weekly',version:0,data:{...blankProject,title:'Collect Weekly Auctions',brief:'Prepare recurring auction reminders.',type:'weekly_auction',owner:'joey',members:['steve','jon','brody'],status:'active',auctionOpensAt:'2026-09-20T12:00',auctionClosesAt:'2026-09-27T21:00'}});
 for(const [hours,day,time] of [[48,25,21],[24,26,21],[2,27,19]]){
  await hq('save-deliverable',{id:'mj-'+hours,version:0,data:{...blankDeliverable,title:`Michael Jordan Auction — ${hours} Hour Reminder`,instructions:'Create the Michael Jordan consignment reminder. Check card and auction details before publishing.',owner:'jon',contributors:['steve','brody'],projectId:'weekly',productionDue:`2026-09-${day}T${time}:00`,publishAt:`2026-09-${day}T${time}:00`,format:'Vertical video',caption:'Michael Jordan auction reminder.',publisher:'steve',references:['https://example.test/mj-final.mp4'],linkRoles:{'https://example.test/mj-final.mp4':'final'}}});
 }
 await db.exec("reset role;update marketing_records set data=data||jsonb_build_object('campaignReference','Michael Jordan Consignment','reminderHours',substring(id from 4)::int,'auctionClosesAt','2026-09-27T21:00:00-05:00','priority','normal','notes','Check the auction details.','sourceProjectId','preserved-source','preservedMetadata',jsonb_build_object('keep',true)) where kind='deliverable'");
 if(numbered){
  await db.exec("reset role;update marketing_records set data=data||jsonb_build_object('sourceProjectId','mj-consignment-video-2026-09-23') where kind='deliverable'");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  const file=(await readdir(directory)).find(f=>f.endsWith('_auction_campaign_permissions_budgets.sql'));await db.exec(await readFile(new URL(file,directory),'utf8'));
  const reusable=(await readdir(directory)).find(f=>f.endsWith('_reusable_weekly_auctions.sql'));if(reusable)await db.exec(await readFile(new URL(reusable,directory),'utf8'));
 }
 return {db,actor,hq,get,save};
}
