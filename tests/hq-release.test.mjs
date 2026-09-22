import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {blankRequest,blankProject,blankDeliverable,hqCommand,projectDraft,deliverableDraft} from '../lib/hq-model.ts';

import {blankQueue} from '../lib/content-radar/editorial-model.ts';

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
 migration=await readFile(new URL('../supabase/hq-release.sql',import.meta.url),'utf8');await db.exec(migration);
});
after(async()=>{await db?.close();await rm(dir,{recursive:true,force:true});});

async function ops(action,payload={}){return (await db.query('select hub_hq_operations($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
async function notifications(){return (await ops('notification-list')).items;}
async function allNotifications(){return (await db.query('select * from hq_notifications order by id')).rows;}

test('complete staff request, coordinator, creator, owner, budget approver and publisher workflow persists',async()=>{
 await actor('maker');const r=(await hq('save-request',{id:'release-request',version:0,data:{...blankRequest,title:'Release verification',purpose:'Prepare a fictional launch',requestedDeadline:'2026-01-08T12:00'}})).data;
 const decision={id:'release-request',version:r.version,decisionId:crypto.randomUUID(),decision:'accepted',reason:'Ready for production',targetKind:'project',targetId:'',owner:'owner',approver:'',projectType:'general',publishing:false,platforms:[],effort:'standard'};
 await assert.rejects(hq('decide-request',decision),/coordinator/);
 await actor('admin');const accepted=await hq('decide-request',decision);await hq('decide-request',decision);const pid=accepted.data.conversion.id;assert.equal((await db.query("select id from marketing_records where kind='project'")).rows.length,1);
 await actor('owner');let p=await record('project',pid);p=await saveProject(pid,{...projectDraft(p),status:'active',members:['maker','stranger']},p.version);
 let d=await saveDeliverable('release-work',{...deliverable,projectId:pid,owner:'maker',publisher:'stranger',requiresFinalFile:true});assert.equal(d.productionDue,'2026-01-10T12:00');assert.equal((await record('request','release-request')).requestedDeadline,'2026-01-08T12:00');
 await actor('maker');const asset=async(id)=>{const data={id,key:'northside-marketing/'+id,name:id+'.png',type:'image/png',size:68};await db.query("select hub_save_record('upload',$1,$2)",[id,data]);await db.query("insert into storage.objects values(gen_random_uuid(),$1,'marketing-assets',$2)",[data.key,{size:68,mimetype:'image/png'}]);await db.query("select hub_save_record('asset',$1,$2)",[id,data]);return id;};
 const draft=await asset('release-draft');d=await saveDeliverable('release-work',{...deliverableDraft(d),assets:[draft],assetRoles:{[draft]:'draft'}},d.version);await production('release-work','in_progress');await production('release-work','needs_review');
 await actor('owner');await assert.rejects(hq('review',{id:'release-work',version:(await record('deliverable','release-work')).version,decision:'approve',comment:''}),/final file/);await hq('review',{id:'release-work',version:(await record('deliverable','release-work')).version,decision:'changes',comment:'Provide the final output'});
 await actor('maker');const final=await asset('release-final');d=await record('deliverable','release-work');d=await saveDeliverable('release-work',{...deliverableDraft(d),assets:[draft,final],assetRoles:{[draft]:'draft',[final]:'final'},caption:'Final release caption'},d.version);await production('release-work','needs_review');await assert.rejects(hq('review',{id:'release-work',version:(await record('deliverable','release-work')).version,decision:'approve',comment:''}),/approver/);
 await actor('owner');d=(await hq('review',{id:'release-work',version:(await record('deliverable','release-work')).version,decision:'approve',comment:'Final checked'})).data;assert.deepEqual(d.approval.package.finalAssets,[final]);
 await assert.rejects(hq('budget',{id:pid,version:p.version,amountCents:10000}),/budget/i);await actor('joey');p=(await hq('budget',{id:pid,version:p.version,amountCents:10000})).data;
 await actor('owner');await assert.rejects(saveProject(pid,{...projectDraft(p),allocations:[{channel:'Social',amountCents:10001}]},p.version),/approved budget/);p=await saveProject(pid,{...projectDraft(p),allocations:[{channel:'Social',amountCents:8000}]},p.version);
 // Project budget/allocation changes request renewed review before publishing.
 d=await record('deliverable','release-work');assert.equal(d.status,'needs_review');await hq('review',{id:'release-work',version:d.version,decision:'approve',comment:'Current project reviewed'});
 await actor('maker');await assert.rejects(publish('release-work','facebook','published'),/publisher/);
 await actor('stranger');await publish('release-work','facebook','published');d=await record('deliverable','release-work');assert.equal(d.publications.facebook.status,'published');assert.equal(d.publications.instagram.status,'planned');assert.equal(d.publications.facebook.recordedBy,'stranger');
 const before=await db.query("select kind,id,data from marketing_records order by kind,id");await db.close();db=new PGlite(dir);await actor('stranger');assert.deepEqual((await db.query("select kind,id,data from marketing_records order by kind,id")).rows,before.rows);
});

test('recurring template retries and competing creators reuse one occurrence without overwriting later edits',async()=>{
 await actor('maker');const source={title:'Fictional Tuesday',date:'2026-01-06T10:00',timezone:'America/Chicago',source:'facebook',caption:'Template copy',status:'draft',recurrence:'weekly-tuesday'};await db.query("select hub_save_record('post','weekly',$1)",[source]);
 const {recurrence,...copy}=source;const payload={id:crypto.randomUUID(),templateId:'weekly',source,data:{...copy,date:'2026-01-13T10:00'}};const save=p=>db.query('select hub_hq_template($1::jsonb) result',[JSON.stringify(p)]);
 const first=(await save(payload)).rows[0].result;assert.equal(first.existing,false);await save(payload);
 await db.query("select hub_save_record('post',$1,$2)",[first.id,{...payload.data,caption:'Staff-edited occurrence'}]);await actor('owner');const again=(await save({...payload,id:crypto.randomUUID()})).rows[0].result;assert.equal(again.id,first.id);assert.equal(again.existing,true);assert.equal((await record('post',first.id)).caption,'Staff-edited occurrence');
 assert.equal((await db.query("select id from marketing_records where kind='post'")).rows.length,2);assert.deepEqual(await record('post','weekly'),source);
 await assert.rejects(save({...payload,data:{...payload.data,date:'2026-01-20T10:00'},source:{...source,caption:'stale'}}),/series changed/);
 await assert.rejects(save({...payload,id:crypto.randomUUID(),data:{...payload.data,date:'2026-01-21T10:00'}}),/Tuesday/);
 await actor('foreign');await assert.rejects(save(payload),/not found/);await actor('pending');await assert.rejects(save(payload),/Staff access/);await db.exec('reset role;set role anon');await assert.rejects(save(payload),/permission denied/);
 await db.exec('reset role');const before=(await db.query('select * from marketing_records order by workspace_id,kind,id')).rows;await db.exec(migration);assert.deepEqual((await db.query('select * from marketing_records order by workspace_id,kind,id')).rows,before);assert.equal(migration,await readFile(new URL('../supabase/migrations/20260919041852_northside_hq_release_verification.sql',import.meta.url),'utf8'));
});

test('ordinary calendar writes reject ambiguous and nonexistent Chicago times at the database boundary',async()=>{
 await actor('maker');for(const date of ['2026-03-08T02:30','2026-11-01T01:30'])await assert.rejects(db.query("select hub_save_record('post',$1,$2)",[crypto.randomUUID(),{title:'Invalid clock',date,caption:'',status:'draft',source:'facebook'}]),/Chicago time/);
});


test('editorial handoff is explicit, retry-safe, preserves evidence and renews approval after source edits',async()=>{
 const rpc=async(name,...args)=>(await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 let source={...blankQueue,title:'Fictional editorial source',original:'staff pick',permission:'owned',permissionEvidence:'Created in this fictional test',attribution:'Fictional studio',state:'Needs review',facebook:'Reviewed source copy',instagram:'Reviewed source copy',reel:'Source outline',calendarDate:'2026-01-20T10:00'};
 await actor('maker');await rpc('hub_editorial_save','queue','release-editorial',0,JSON.stringify(source));
 const input={id:'radar_release-editorial',owner:'maker',approver:'owner',effort:'standard'};
 const handoff=()=>rpc('hub_hq_editorial',JSON.stringify(input));
 await assert.rejects(handoff(),/coordinator/);await actor('admin');await assert.rejects(handoff(),/Approve the current/);
 source={...source,state:'Approved'};await rpc('hub_editorial_save','queue','release-editorial',1,JSON.stringify(source));await rpc('hub_calendar','release-editorial');
 const calendarBefore=await record('post',input.id),result=await handoff(),id=result.id;assert.equal((await handoff()).id,id);
 let d=await record('deliverable',id);assert.equal(d.owner,'maker');assert.equal(d.approver,'owner');assert.equal(d.productionDue,'');assert.equal(d.approval,null);assert.equal(d.publications.facebook.status,'planned');assert.equal(d.editorialSource.data.facebook,source.facebook);
 assert.deepEqual(await record('post',input.id),calendarBefore);assert.equal((await rpc('hub_calendar','release-editorial')).hqId,id);
 await actor('owner');d=await saveDeliverable(id,{...deliverableDraft(d),instructions:'Adapt and compare source evidence',productionDue:'2026-01-19T12:00',format:'Text',requiresFinalFile:false,publisher:'stranger'},d.version);await production(id,'in_progress');await production(id,'needs_review');
 await actor('owner');await hq('review',{id,version:(await record('deliverable',id)).version,decision:'approve',comment:'Source checked'});
 await actor('maker');source={...source,facebook:'Corrected source facts'};await rpc('hub_editorial_save','queue','release-editorial',2,JSON.stringify(source));
 d=await record('deliverable',id);assert.equal(d.approval,null);assert.equal(d.status,'in_progress');assert.equal(d.editorialSource.data.state,'Needs review');assert.equal(d.caption,calendarBefore.caption);assert.deepEqual(await record('post',input.id),calendarBefore);
 await production(id,'needs_review');await actor('owner');await assert.rejects(hq('review',{id,version:(await record('deliverable',id)).version,decision:'approve',comment:''}),/current editorial source/);
 await actor('stranger');await assert.rejects(publish(id,'facebook','published'),/approved|Ready|approval/);
 await actor('admin');await rpc('hub_editorial_save','queue','release-editorial',3,JSON.stringify({...source,state:'Approved'}));await actor('maker');d=await record('deliverable',id);d=await saveDeliverable(id,{...deliverableDraft(d),caption:'Corrected source facts'},d.version);await production(id,'needs_review');
 await actor('owner');await hq('review',{id,version:(await record('deliverable',id)).version,decision:'approve',comment:'Corrected facts checked'});await actor('stranger');await publish(id,'facebook','published');const published=await record('deliverable',id);
 await actor('maker');await rpc('hub_editorial_save','queue','release-editorial',4,JSON.stringify({...source,facebook:'Later facts'}));assert.deepEqual(await record('deliverable',id),published,'fully published output remains history');
 await actor('foreign');await assert.rejects(handoff(),/coordinator/);await actor('pending');await assert.rejects(handoff(),/Staff access/);await db.exec('reset role;set role anon');await assert.rejects(handoff(),/permission denied/);
});
