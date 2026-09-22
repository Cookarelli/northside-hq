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
// This suite verifies the immutable first HQ migration; later fields are tested in hq-workflow.test.mjs.
const historicalData=data=>Object.fromEntries(Object.entries(data).filter(([k])=>!["assetRoles","linkRoles","publisher","requiresFinalFile","requiresCaption","promotionMode","promotionChannel","promotionCents"].includes(k)));
async function saveProject(id,data,version=0){data=historicalData(data);return (await hq('save-project',{id,version,data})).data;}
async function saveDeliverable(id,data,version=0){data=historicalData(data);return (await hq('save-deliverable',{id,version,data})).data;}
async function production(id,status){return (await hq('production',{id,version:(await record('deliverable',id)).version,status})).data;}
async function publish(id,platform,status,extra={}) {return (await hq('publication',{id,version:(await record('deliverable',id)).version,platform,status,confirmed:true,time:'2026-01-12T14:00',url:'https://example.test/live',unavailableReason:'',...extra})).data;}
const project={...blankProject,title:'Fictional launch',brief:'Prepare the launch',owner:'owner',members:['maker'],status:'active'};
const deliverable={...blankDeliverable,title:'Fictional announcement',instructions:'Prepare and check the creative',owner:'maker',projectId:'p1',productionDue:'2026-01-10T12:00',publishAt:'2026-01-12T14:00',format:'Image',caption:'Fictional caption'};
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
});
after(async()=>{await db?.close();await rm(dir,{recursive:true,force:true});});

test('HQ roster, RLS and all public write surfaces reject unauthorized access',async()=>{
 await db.exec('set role anon');await assert.rejects(hq('context'),/permission denied/);
 for(const table of ['hq_activity','hq_comments','marketing_records']) await assert.rejects(db.query('select * from public.'+table),/permission denied/);
 await actor('pending');await assert.rejects(hq('context'),/Staff access required/);
 await actor('owner');assert.equal((await hq('context')).staffId,'owner');assert.equal((await hq('context')).canApproveBudget,false);
 await assert.rejects(db.exec("insert into public.marketing_records values('northside-marketing','project','evil','{}',now())"),/permission denied/);
 await assert.rejects(db.exec("select private.hq_put('northside-marketing','project','evil','{}','forged')"),/permission denied/);
 await assert.rejects(db.exec("select public.hub_save_record('project','evil','{}')"),/Invalid record/);
 await assert.rejects(db.exec("select * from private.hq_permissions"),/permission denied/);
});

test('projects persist; budget capability is independent, configurable and allocation-limited',async()=>{
 await actor('owner');let p=await saveProject('p1',project);
 await assert.rejects(hq('budget',{id:'p1',version:p.version,amountCents:10000}),/permission is required/);
 await assert.rejects(saveProject('p1',{...project,budget:{amountCents:999999}},p.version),/controlled/);
 await actor('admin');await assert.rejects(hq('budget',{id:'p1',version:p.version,amountCents:10000}),/permission is required/);
 await actor('joey');p=(await hq('budget',{id:'p1',version:p.version,amountCents:10000})).data;assert.equal(p.budget.approvedBy,'joey');
 await assert.rejects(saveProject('p1',{...project,allocations:[{channel:'Instagram',amountCents:100}]},p.version),/Only the project owner/);
 await actor('owner');await assert.rejects(saveProject('p1',{...project,allocations:[{channel:'Instagram',amountCents:10001}]},p.version),/exceed/);
 p=await saveProject('p1',{...project,allocations:[{channel:'Instagram',amountCents:6000},{channel:'Facebook',amountCents:4000}]},p.version);
 await assert.rejects(saveProject('p1',project,1),/Someone changed/);
 await actor('admin');await assert.rejects(saveProject('p1',{...project,allocations:[]},p.version),/Only the current project owner/);
 await hq('permission',{staffId:'joey',enabled:false});await actor('joey');assert.equal((await hq('context')).canApproveBudget,false);
 await db.exec('reset role');await db.exec(migration);await actor('joey');assert.equal((await hq('context')).canApproveBudget,false,'repeated migration must not undo permission revocation');
 await actor('admin');await hq('permission',{staffId:'joey',enabled:true});await hq('permission',{staffId:'owner',enabled:true});await actor('owner');
 await assert.rejects(hq('budget',{id:'p1',version:p.version,amountCents:9999}),/less than existing/);
 await actor('admin');await hq('permission',{staffId:'owner',enabled:false});
});

test('deliverables enforce assignment, ordered review, active budgets and exact owner approval',async()=>{
 await actor('stranger');await assert.rejects(saveDeliverable('d1',deliverable),/Only project members/);
 await actor('maker');let d=await saveDeliverable('d1',deliverable);
 await assert.rejects(saveDeliverable('d1',{...deliverable,approver:'maker',projectId:''},d.version),/current approver/);
 await assert.rejects(production('d1','ready'),/in order/);
 await production('d1','in_progress');await production('d1','needs_review');
 await assert.rejects(production('d1','ready'),/Only the project owner/);
 await actor('admin');await assert.rejects(production('d1','ready'),/Only the project owner/);
 await actor('owner');d=await production('d1','ready');assert.equal(d.approval.by,'owner');
 await assert.rejects(production('d1','done'),/each publishing destination/);
 await actor('maker');d=await saveDeliverable('d1',{...deliverable,caption:'Revised caption'},d.version);assert.equal(d.status,'needs_review');assert.equal(d.approval,null);
 await actor('owner');await production('d1','ready');
 const p=await record('project','p1');await saveProject('p1',{...project,brief:'Changed scope',allocations:p.allocations},p.version);
 await actor('maker');await assert.rejects(publish('d1','facebook','scheduled'),/Current owner approval/);
 await actor('owner');await production('d1','ready');
 const p2=await saveProject('no-budget',{...project,title:'Unfunded'});
 await saveDeliverable('unfunded',{...deliverable,projectId:'no-budget'});await production('unfunded','in_progress');await production('unfunded','needs_review');await assert.rejects(production('unfunded','ready'),/approved budget/);
 await actor('joey');await hq('budget',{id:'no-budget',version:p2.version,amountCents:0});await actor('owner');await production('unfunded','ready');
});

test('manual platform confirmations stay separate and retain immutable publication facts',async()=>{
 await actor('maker');let d=await record('deliverable','d1');
 assert.equal(d.publications.facebook.status,'planned');assert.equal(d.publications.instagram.status,'planned');
 await assert.rejects(publish('d1','facebook','scheduled',{confirmed:false}),/Explicitly confirm/);
 await assert.rejects(publish('d1','facebook','scheduled',{time:'2026-03-08T02:30'}),/Chicago time/);
 await assert.rejects(publish('d1','facebook','scheduled',{time:'2026-11-01T01:30'}),/Chicago time/);
 d=await publish('d1','facebook','scheduled');assert.equal(d.publications.facebook.scheduledBy,'maker');assert.equal(d.publications.instagram.status,'planned');
 await assert.rejects(saveDeliverable('d1',deliverable,d.version),/Confirmed work is locked/);
 await publish('d1','facebook','planned');
 await assert.rejects(publish('d1','facebook','published',{time:'2099-01-01T12:00'}),/cannot be in the future/);
 await assert.rejects(publish('d1','facebook','published',{url:'',unavailableReason:''}),/live URL/);
 await assert.rejects(publish('d1','x','published'),/Choose a destination/);
 d=await publish('d1','facebook','published');assert.equal(d.publications.facebook.status,'published');assert.equal(d.publications.instagram.status,'planned');
 await assert.rejects(publish('d1','facebook','planned'),/permanent/);
 await assert.rejects(saveDeliverable('d1',deliverable,d.version),/Confirmed work is locked/);
 d=await publish('d1','instagram','published',{url:'',unavailableReason:'This destination does not provide a public permalink.'});assert.equal(d.publications.instagram.status,'published');
});

test('standalone tasks need an approver; blocked flags, scoped assets and Done are enforced',async()=>{
 await actor('maker');const data={...blankDeliverable,title:'Prepare files',instructions:'Check the files',owner:'maker',publishing:false,platforms:[],productionDue:'2026-01-12T10:00'};
 await assert.rejects(saveDeliverable('task',data),/designated approver/);
 await assert.rejects(saveDeliverable('task',{...data,approver:'foreign'}),/designated approver/);
 await assert.rejects(saveDeliverable('task',{...data,approver:'owner',assets:['foreign-asset']}),/saved asset/);
 await assert.rejects(saveDeliverable('task',{...data,approver:'owner',blocked:true}),/Blocked work needs/);
 let d=await saveDeliverable('task',{...data,approver:'owner',blocked:true,blockedReason:'Need source files',blockedBy:'owner'});
 await production('task','in_progress');d=await production('task','needs_review');await actor('owner');await assert.rejects(production('task','ready'),/blocked work/);
 d=await saveDeliverable('task',{...data,approver:'owner'},d.version);await production('task','ready');await actor('maker');d=await production('task','done');assert.equal(d.status,'done');
});

test('comments and history are scoped, append-only and persist across a database restart',async()=>{
 await actor('stranger');await hq('comment',{kind:'project',id:'p1',commentId:'11111111-1111-4111-8111-111111111111',body:'Internal project note'});
 await hq('comment',{kind:'project',id:'p1',commentId:'11111111-1111-4111-8111-111111111111',body:'Internal project note'});
 assert.equal((await db.query('select * from public.hq_comments')).rows.length,1);
 for(const table of ['hq_comments','hq_activity']) for(const operation of ['update '+table+" set actor='forged'",'delete from '+table]) await assert.rejects(db.exec(operation),/permission denied/);
 await actor('foreign');assert.equal((await db.query('select * from public.hq_comments')).rows.length,0);assert.equal((await db.query('select * from public.hq_activity')).rows.length,0);assert.equal(await record('project','p1'),undefined);
 await assert.rejects(hq('comment',{kind:'project',id:'p1',commentId:'22222222-1111-4111-8111-111111111111',body:'Intrusion'}),/not found/);
 await actor('owner');const before=await record('deliverable','d1');const history=(await db.query('select count(*)::int as n from public.hq_activity')).rows[0].n;
 await db.close();db=new PGlite(dir);await actor('owner');assert.deepEqual(await record('deliverable','d1'),before);assert.equal((await db.query('select count(*)::int as n from public.hq_activity')).rows[0].n,history);
 await db.exec("reset role;update private.staff_access set active=false where id='maker'");await actor('maker');await assert.rejects(hq('context'),/Staff access required/);assert.equal((await db.query('select * from public.marketing_records')).rows.length,0);
 await db.exec("reset role;update private.staff_access set active=true where id='maker'");
});

test('legacy adoption is explicit, repeatable, preserves unknown history and freezes old writes',async()=>{
 const campaign={name:'Legacy batch',owner:'owner',opening:'2026-01-01T10:00',closing:'2026-01-07T18:00',auctionPlatform:'Example',batchUrl:'https://example.test/batch',cards:[{name:'Card',url:'https://example.test/lot'}]};
 const post={title:'Legacy opening',date:'2026-01-02T12:00',source:'facebook',platforms:['facebook','instagram'],owner:'unknown-historical-person',status:'published',caption:'Legacy caption',references:[],assets:[],tasks:['Prepare asset'],consignment:{campaignId:'old-campaign',stage:'opening',slot:'opening'}};
 await db.exec('reset role');await db.query("insert into public.marketing_records(workspace_id,kind,id,data) values('northside-marketing','campaign','old-campaign',$1),('northside-marketing','post','old-post',$2)",[campaign,post]);
 await actor('stranger');await assert.rejects(hq('adopt-campaign',{id:'old-campaign'}),/Only the campaign owner/);
 await actor('owner');const p=await hq('adopt-campaign',{id:'old-campaign'});assert.equal((await hq('adopt-campaign',{id:'old-campaign'})).id,p.id);
 assert.deepEqual(await record('campaign','old-campaign'),campaign);assert.deepEqual(await record('post','old-post'),post);
 const d=(await db.query("select id,data from public.marketing_records where kind='deliverable' and data->>'legacyPostId'='old-post'")).rows[0];assert.equal(d.data.owner,'');assert.equal(d.data.effort,null);assert.equal(d.data.approval,null);assert.equal(d.data.publications.facebook.status,'planned');assert.equal(d.data.legacyPost.status,'published');
 await assert.rejects(db.query("select public.hub_save_record('post','old-post',$1)",[{...post,status:"draft",owner:"owner",category:"Consignment"}]),/Northside HQ/);
 await db.exec('reset role');await assert.rejects(db.exec("update public.marketing_records set data=data where id='old-campaign'"),/Northside HQ/);
 await actor('owner');assert.equal((await hq('adopt-post',{id:'old-post'})).id,d.id,'post adoption retry must not create another source of truth');
});

test('HTTP command schemas reject forged managed fields and invalid times',()=>{
 assert.equal(hqCommand.safeParse({action:'save-project',id:'p',version:0,data:{...project,budget:{amountCents:100}}}).success,false);
 assert.equal(hqCommand.safeParse({action:'save-deliverable',id:'d',version:0,data:{...deliverable,approval:{by:'maker'}}}).success,false);
 assert.equal(hqCommand.safeParse({action:'save-deliverable',id:'d',version:0,data:{...deliverable,productionDue:'2026-03-08T02:30'}}).success,false);
});

test('adopted production retains evidence gates and forbids shadow legacy posts',async()=>{
 await actor('owner');const p=(await db.query("select id,data from public.marketing_records where kind='project' and data->>'legacyCampaignId'='old-campaign'")).rows[0];
 let d=(await db.query("select id,data from public.marketing_records where kind='deliverable' and data->>'legacyPostId'='old-post'")).rows[0];
 const legacy=await record('post','old-post');
 await assert.rejects(db.query("select public.hub_save_record('post','new-shadow-post',$1)",[{...legacy,owner:'owner',status:'draft',category:'Consignment'}]),/campaign membership/);
 await db.exec('reset role');await assert.rejects(db.query("insert into public.marketing_records values('northside-marketing','post','new-shadow-post',$1,now())",[legacy]),/Northside HQ/);await actor('owner');
 p.data=await saveProject(p.id,{...projectDraft(p.data),brief:'Review the legacy campaign',status:'active'},p.data.version);
 await actor('joey');p.data=(await hq('budget',{id:p.id,version:p.data.version,amountCents:0})).data;
 await actor('owner');
 const input={...deliverableDraft(d.data),owner:'maker',instructions:'Finish the original tasks',effort:'standard',productionDue:'2026-01-01T12:00',format:'Image'};
 await assert.rejects(saveDeliverable(d.id,{...input,evidence:{completedTasks:{'Prepare asset':true}}},d.data.version),/must be a list/);
 d.data=await saveDeliverable(d.id,input,d.data.version);
 await production(d.id,'in_progress');d.data=await production(d.id,'needs_review');await assert.rejects(production(d.id,'ready'),/finished creative/);
 await db.exec('reset role');await db.exec("insert into public.marketing_records values('northside-marketing','asset','hq-test-asset','{\"name\":\"Fictional creative.png\"}',now())");await actor('owner');
 d.data=await saveDeliverable(d.id,{...input,assets:['hq-test-asset']},d.data.version);await assert.rejects(production(d.id,'ready'),/outstanding production tasks/);
 d.data=await saveDeliverable(d.id,{...input,assets:['hq-test-asset'],evidence:{completedTasks:['Prepare asset']}},d.data.version);d.data=await production(d.id,'ready');assert.equal(d.data.approval.by,'owner');
 assert.deepEqual(await record('post','old-post'),legacy);
 // Reuse the exact closing/recap verifier: changed auction facts must not reuse old evidence.
 await db.exec('reset role');await db.query("insert into public.marketing_records values('northside-marketing','campaign','closing-campaign',$1,now()),('northside-marketing','post','closing-post',$2,now())",[{name:'Closing batch',owner:'owner',opening:'2026-01-01T10:00',closing:'2026-01-07T18:00',auctionPlatform:'Example',batchUrl:'https://example.test/batch',cards:[{name:'Card',url:'https://example.test/lot'}]},{...legacy,owner:'owner',status:'draft',date:'2026-01-07T16:00',assets:['verified-legacy-file'],tasks:[],consignment:{campaignId:'closing-campaign',stage:'closing',slot:'closing'}}]);
 await actor('owner');const closingProject=await hq('adopt-campaign',{id:'closing-campaign'});let cp=await saveProject(closingProject.id,{...projectDraft(closingProject.data),brief:'Close the auction',status:'active'},1);
 await actor('joey');cp=(await hq('budget',{id:closingProject.id,version:cp.version,amountCents:0})).data;await actor('owner');
 const closing=(await db.query("select id,data from public.marketing_records where kind='deliverable' and data->>'legacyPostId'='closing-post'")).rows[0];
 let cd=await saveDeliverable(closing.id,{...deliverableDraft(closing.data),effort:'quick',instructions:'Check exact deadline',productionDue:'2026-01-07T12:00',format:'Image'},1);await production(closing.id,'in_progress');cd=await production(closing.id,'needs_review');await assert.rejects(production(closing.id,'ready'),/current auction facts/);
 const facts={closing:cp.auctionClosesAt,batchUrl:cp.auction.batchUrl,cards:cp.auction.cards};
 cd=await saveDeliverable(closing.id,{...deliverableDraft(cd),references:['https://example.test/lot'],evidence:{verification:{auction:facts,reviewedCaption:cd.caption,closing:cp.auctionClosesAt,lotLinksChecked:true}}},cd.version);await production(closing.id,'ready');
 cp=await saveProject(closingProject.id,{...projectDraft(cp),auctionClosesAt:'2026-01-07T19:00'},cp.version);await assert.rejects(production(closing.id,'ready'),/current auction facts/);
});

test('all project types, missing information, assignment escalation and draft ownership are checked',async()=>{
 await actor('owner');
 for(const type of ['weekly_auction','event','product_release','general']) {
  const data={...blankProject,title:'Type '+type,type,owner:'owner'};
  const p=await saveProject('type-'+type,data);assert.equal(p.type,type);
  if(type!=='general') await assert.rejects(saveProject('type-'+type,{...data,status:'active',brief:'Description'},1),/relevant dates/);
 }
 let p=await saveProject('unassigned-draft',{...blankProject,title:'Draft without owner'});p=await saveProject('unassigned-draft',{...blankProject,title:'Owned draft',owner:'owner'},p.version);assert.equal(p.owner,'owner');
 await actor('maker');let d=await saveDeliverable('assignments',{...deliverable,projectId:'p1'});
 await assert.rejects(saveDeliverable('assignments',{...deliverable,contributors:['stranger']},d.version),/current approver/);
 await actor('owner');d=await saveDeliverable('assignments',{...deliverable,owner:'stranger',contributors:['maker']},d.version);assert.equal(d.owner,'stranger');
 await actor('foreign');await assert.rejects(hq('production',{id:'assignments',version:d.version,status:'in_progress'}),/Someone changed|not found/);
});

test('reapplying the migration preserves every record, confirmation, comment and activity event',async()=>{
 await db.exec('reset role');
 const dump=async()=>({records:(await db.query('select * from public.marketing_records order by workspace_id,kind,id')).rows,comments:(await db.query('select * from public.hq_comments order by org_id,id')).rows,activity:(await db.query('select * from public.hq_activity order by org_id,id')).rows});
 const before=await dump();await db.exec(migration);await db.exec(migration);assert.deepEqual(await dump(),before);
 assert.equal(migration,await readFile(new URL('../supabase/hq.sql',import.meta.url),'utf8'),'reviewed module and additive migration must agree');
});
