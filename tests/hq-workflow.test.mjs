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
});
after(async()=>{await db?.close();await rm(dir,{recursive:true,force:true});});

const request={title:'Fictional request',purpose:'An internal launch',requestedDeadline:'2026-01-08T12:00',assets:[],references:['https://example.test/brief'],assetRoles:{},linkRoles:{}};
const decide=(id,extra={})=>({id,version:1,decisionId:crypto.randomUUID(),decision:'accepted',reason:'Fits our plans',targetKind:'project',targetId:'',owner:'owner',approver:'owner',projectType:'general',publishing:false,platforms:[],effort:'standard',...extra});
async function review(id,decision='approve',comment='Checked the final version') {return (await hq('review',{id,version:(await record('deliverable',id)).version,decision,comment})).data;}
async function submit(id){await production(id,'in_progress');return production(id,'needs_review');}

test('coordinator capability is separate from budget permission and safe to revoke',async()=>{
 await actor('admin');let c=await hq('context');assert.equal(c.canCoordinate,true);assert.equal(c.canApproveBudget,false);
 await actor('joey');c=await hq('context');assert.equal(c.canCoordinate,false);assert.equal(c.canApproveBudget,true);
 await actor('maker');await assert.rejects(hq('permission',{staffId:'maker',capability:'coordinate_requests',enabled:true}),/administrators/);
 await actor('admin');await hq('permission',{staffId:'admin',capability:'coordinate_requests',enabled:false});await db.exec('reset role');await db.exec(migration);await actor('admin');assert.equal((await hq('context')).canCoordinate,false);await hq('permission',{staffId:'admin',capability:'coordinate_requests',enabled:true});
});

test('requests retain identity and deadlines; all four conversion targets persist and retries cannot duplicate',async()=>{
 await actor('maker');await hq('save-request',{id:'r1',version:0,data:request});
 await assert.rejects(hq('save-request',{id:'forged',version:0,data:{...request,requester:'owner'}}),/managed/);
 await actor('stranger');await assert.rejects(hq('save-request',{id:'r1',version:1,data:request}),/requester/);await assert.rejects(hq('decide-request',decide('r1')),/coordinator/);
 await actor('admin');const cmd=decide('r1');const accepted=await hq('decide-request',cmd);const p=await record('project',accepted.data.conversion.id);
 assert.equal(p.owner,'owner');assert.equal(p.status,'draft');assert.equal(p.eventAt,'');assert.equal(p.budget,null);assert.equal(accepted.data.requester,'maker');assert.equal(accepted.data.requestedDeadline,request.requestedDeadline);
 assert.deepEqual(await hq('decide-request',cmd),accepted);await assert.rejects(hq('decide-request',{...cmd,reason:'different'}),/retry/);await assert.rejects(hq('decide-request',decide('r1')),/already been decided/);
 for(const [id,targetKind,targetId] of [['r2','project',accepted.data.conversion.id],['r3','deliverable',''],['r4','deliverable','']]) {
  await hq('save-request',{id,version:0,data:request});const existing=id==='r4'?(await record('request','r3')).conversion.id:targetId;
  const out=await hq('decide-request',decide(id,{targetKind,targetId:existing}));assert.equal(out.data.conversion.kind,targetKind);
  if(id==='r3'){const d=await record('deliverable',out.data.conversion.id);assert.equal(d.productionDue,'');assert.equal(d.approver,'owner');assert.equal(d.approval,null);}
  if(existing)assert.equal(out.data.conversion.id,existing);
 }
 assert.equal((await db.query("select count(*)::int n from marketing_records where kind='project'")).rows[0].n,1);
 await hq('save-request',{id:'decline',version:0,data:request});await assert.rejects(hq('decide-request',decide('decline',{decision:'declined',reason:''})),/reason/);
 const declined=await hq('decide-request',decide('decline',{decision:'declined',reason:'Outside current scope'}));assert.equal(declined.data.decision.by,'admin');assert.equal(declined.data.conversion,undefined);
});

test('request, comment and asset access rejects signed-out and unrelated organizations',async()=>{
 await db.exec('reset role');await db.exec("insert into marketing_records values('northside-marketing','asset','asset1','{\"name\":\"Final.png\",\"type\":\"image/png\"}',now()),('other-org','asset','foreign-asset','{\"name\":\"Private.png\"}',now())");
 await actor('maker');await assert.rejects(hq('save-request',{id:'private-ref',version:0,data:{...request,assets:['foreign-asset']}}),/saved asset/);
 await assert.rejects(hq('save-request',{id:'bad-role',version:0,data:{...request,linkRoles:{'https://example.test/brief':'final'}}}),/reference material/);
 await hq('comment',{id:'r1',kind:'request',commentId:crypto.randomUUID(),body:'A request note'});
 await actor('foreign');assert.equal(await record('request','r1'),undefined);assert.equal(await record('asset','asset1'),undefined);assert.equal((await db.query('select * from hq_comments')).rows.length,0);assert.equal((await db.query('select * from hq_activity')).rows.length,0);
 await assert.rejects(hq('decide-request',decide('r1')),/coordinator/);
 await db.exec('reset role;set role anon');await assert.rejects(hq('context'),/permission denied/);await assert.rejects(db.query('select * from marketing_records'),/permission denied/);await assert.rejects(db.query("select private.hq_request('save-request','{}')"),/permission denied/);
});

test('review binds exact output version, supports change comments, and organic needs no budget',async()=>{
 await actor('owner');await saveProject('p1',project);await actor('maker');let d=await saveDeliverable('d1',deliverable);await submit('d1');
 await assert.rejects(review('d1'),/current approver/);await actor('admin');await assert.rejects(review('d1'),/current approver/);await actor('owner');await assert.rejects(review('d1','changes',''),/comment/);
 d=await review('d1','changes','Please revise the wording');assert.equal(d.status,'in_progress');assert.equal(d.approval,null);assert.equal(d.review.comment,'Please revise the wording');
 await production('d1','needs_review');const submitted=await record('deliverable','d1');d=await review('d1');assert.equal(d.status,'ready');assert.equal(d.approval.reviewedVersion,submitted.version);assert.equal(d.approval.contentVersion,d.contentVersion);assert.equal(d.approval.package.caption,deliverable.caption);assert.equal(d.approval.package.promotionCents,0);assert.equal((await record('project','p1')).budget,null);
 for(const patch of [{caption:'Updated copy'},{destinationUrl:'https://example.test/new'},{assets:['asset1'],assetRoles:{asset1:'final'},requiresFinalFile:true}]) {
  await actor('maker');d=await saveDeliverable('d1',{...deliverableDraft(d),...patch},d.version);assert.equal(d.approval,null);assert.equal(d.submission,null);assert.equal(d.status,'in_progress');
  await actor('owner');await assert.rejects(review('d1'),/submitted/);await production('d1','needs_review');d=await review('d1');
 }
 assert.deepEqual(d.approval.package.finalAssets,['asset1']);
 await actor('maker');await assert.rejects(saveDeliverable('d1',{...deliverableDraft(d),assetRoles:{missing:'final'}},d.version),/attached materials/);
});

test('internal tasks need no caption; required final material is visible and enforced',async()=>{
 await actor('maker');const input={...blankDeliverable,title:'Internal check',instructions:'Check the source',owner:'maker',approver:'owner',productionDue:'2026-01-10T12:00',publishing:false,platforms:[],requiresCaption:false,requiresFinalFile:false};
 await saveDeliverable('task',input);await submit('task');await actor('owner');await review('task');await actor('maker');assert.equal((await production('task','done')).status,'done');
 await saveDeliverable('missing-final',{...deliverable,requiresFinalFile:true});await submit('missing-final');await actor('owner');await assert.rejects(review('missing-final'),/final file/);
});

test('promotion allocations cannot exceed approved channels or be granted by producers',async()=>{
 await actor('joey');let p=await record('project','p1');p=(await hq('budget',{id:'p1',version:p.version,amountCents:10000})).data;
 await actor('owner');p=await saveProject('p1',{...projectDraft(p),allocations:[{channel:'Social',amountCents:10000}]},p.version);
 const paid={...deliverable,promotionMode:'paid',promotionChannel:'Social',promotionCents:6000};
 await actor('maker');await assert.rejects(saveDeliverable('paid',paid),/project owner/);await actor('owner');await saveDeliverable('paid',paid);await assert.rejects(saveDeliverable('paid2',paid),/including other/);
 await assert.rejects(saveProject('p1',{...projectDraft(p),allocations:[{channel:'Social',amountCents:5000}]},p.version),/committed deliverable/);
});

test('handoffs require assigned publisher and explicit independent platform confirmations',async()=>{
 await actor('owner');await review('d1');await actor('stranger');await assert.rejects(publish('d1','facebook','scheduled'),/assigned publisher/);
 await actor('maker');await assert.rejects(publish('d1','facebook','scheduled',{confirmed:false}),/Explicitly/);await assert.rejects(publish('d1','facebook','published',{url:'',unavailableReason:''}),/live URL/);
 let d=await publish('d1','facebook','scheduled');assert.equal(d.publications.instagram.status,'planned');await assert.rejects(saveDeliverable('d1',deliverableDraft(d),d.version),/locked/);
 await publish('d1','facebook','planned');d=await publish('d1','facebook','published');assert.equal(d.publications.facebook.approval.package.caption,d.caption);assert.equal(d.publications.instagram.status,'planned');await assert.rejects(publish('d1','facebook','planned'),/permanent/);
});

test('migration reruns and database restart preserve decided requests, review history and publishing packages',async()=>{
 await actor('owner');const rows=(await db.query("select kind,id,data from marketing_records order by kind,id")).rows;const history=(await db.query('select * from hq_activity order by id')).rows;
 assert.equal(migration,await readFile(new URL('../supabase/migrations/20260919023059_northside_hq_requests_review_handoff.sql',import.meta.url),'utf8'));
 await db.exec('reset role');await db.exec(migration);await db.close();db=new PGlite(dir);await actor('owner');assert.deepEqual((await db.query("select kind,id,data from marketing_records order by kind,id")).rows,rows);assert.deepEqual((await db.query('select * from hq_activity order by id')).rows,history);
});

test('private storage requires finished matching bytes and prevents cross-workspace reads or overwrites',async()=>{
 await actor('maker');const id=crypto.randomUUID(),key='northside-marketing/'+id,upload={id,key,name:'Private final.png',type:'image/png',size:68,public:true};
 await db.query("select hub_save_record('upload',$1,$2)",[id,upload]);await assert.rejects(db.query("select hub_save_record('asset',$1,$2)",[id,upload]),/finish/);
 await assert.rejects(db.query("insert into storage.objects values(gen_random_uuid(),'other-org/intrusion','marketing-assets','{}')"),/row-level security/);
 await db.query("insert into storage.objects values(gen_random_uuid(),$1,'marketing-assets',$2)",[key,{size:68,mimetype:'image/png'}]);await db.query("select hub_save_record('asset',$1,$2)",[id,upload]);
 await assert.rejects(db.query("select hub_save_record('asset',$1,$2)",[id,{...upload,key:'other-org/private'}]),/finish/);
 await assert.rejects(db.query("update storage.objects set metadata='{}' where name=$1",[key]),/permission denied/);
 await actor('foreign');assert.equal((await db.query('select * from storage.objects where name=$1',[key])).rows.length,0);assert.equal(await record('asset',id),undefined,'metadata public flag cannot authorize access');
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from storage.objects'),/permission denied/);
});

test('older approvals remain history and cannot silently become approved publishing packages',async()=>{
 await db.exec('reset role');const legacy={...deliverable,status:'ready',version:5,createdBy:'maker',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',approval:{by:'owner',at:'2026-01-01T00:00:00Z'},publications:{facebook:{status:'planned'},instagram:{status:'planned'}}};
 for(const key of ['publisher','requiresFinalFile','requiresCaption','assetRoles','linkRoles','promotionMode','promotionCents','promotionChannel'])delete legacy[key];
 await db.query("insert into marketing_records values('northside-marketing','deliverable','historic-approval',$1,now())",[legacy]);await db.exec(migration);await actor('owner');assert.deepEqual(await record('deliverable','historic-approval'),legacy);
 await assert.rejects(publish('historic-approval','facebook','scheduled'),/Current owner approval/);await production('historic-approval','needs_review');await assert.rejects(review('historic-approval'),/output requirements/);
});

test('failed conversions roll back, cross-workspace targets are rejected and competing decisions cannot duplicate work',async()=>{
 await actor('admin');await hq('save-request',{id:'r-race',version:0,data:request});const invalid=decide('r-race',{targetKind:'deliverable',approver:''});
 const count=async()=>(await db.query("select count(*)::int n from marketing_records where kind='deliverable'")).rows[0].n;const before=await count();
 await assert.rejects(hq('decide-request',invalid),/approver/);assert.equal((await record('request','r-race')).status,'new');assert.equal(await count(),before);
 await assert.rejects(hq('decide-request',decide('r-race',{targetId:'foreign-target'})),/this organization/);
 const attempts=await Promise.allSettled([hq('decide-request',decide('r-race',{targetKind:'deliverable'})),hq('decide-request',decide('r-race',{targetKind:'deliverable'}))]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(await count(),before+1);
});
