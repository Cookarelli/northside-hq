import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auctionDb} from './helpers/auction-db.mjs';
import {jonAssetIds,filterAssets,newestAssets,assignedAssetIds,assetDeliverableHref,assetProjectHref} from '../lib/hq-assets.ts';
import {assetContentType,assetProblem,supportedAssetTypes} from '../lib/asset-policy.ts';

test('Jon upload collection survives reassignment; history filters/search/order do not change latest uploads',()=>{
 const records=[{kind:'asset',id:'new',data:{name:'DSC1234.JPG',title:'Auction hero',uploadedAt:'2026-09-24T04:00:00Z',collection:'jons-content',uploadedBy:'brody'}},{kind:'asset',id:'old',data:{name:'Jon clip.mp4',createdAt:'2026-09-23T20:00:00Z',uploadedBy:'jon',assignedProjectId:'weekly'}},{kind:'asset',id:'other',data:{name:'Other.png',uploadedBy:'steve'}},{kind:'deliverable',id:'work',data:{owner:'jon',assets:['other']}}];
 const ids=jonAssetIds(records);assert.deepEqual([...ids],['new','old']);
 const latest=newestAssets(records.filter(r=>ids.has(r.id)));
 assert.deepEqual(latest.map(a=>a.id),['new','old']);
 assert.deepEqual(filterAssets(latest,' HERO ','unassigned').map(a=>a.id),['new']);
 assert.deepEqual(filterAssets(latest,'jon CLIP','assigned').map(a=>a.id),['old']);
 assert.equal(filterAssets(latest,'missing','all').length,0);
 assert.deepEqual(latest.map(a=>a.id),['new','old']);
 records[0].data.assignedProjectId='another';assert.ok(jonAssetIds(records).has('new'));
 assert.deepEqual(assignedAssetIds(latest,'project','weekly'),['old']);
});

test('documents and graphics share upload validation, with safe MIME fallbacks and the existing size limit',()=>{
 for(const type of supportedAssetTypes)assert.equal(assetProblem({name:'file',size:123,type}),'');
 assert.equal(assetContentType({name:'BRIEF.DOCX',type:''}),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 assert.equal(assetContentType({name:'budget.csv',type:'application/vnd.ms-excel'}),'text/csv');
 assert.equal(assetContentType({name:'design.svg',type:'application/octet-stream'}),'image/svg+xml');
 assert.ok(assetProblem({name:'script.html',type:'text/html',size:12}));
 assert.ok(assetProblem({name:'file.pdf',type:'application/pdf',size:0}));
 assert.ok(assetProblem({name:'file.pdf',type:'application/pdf',size:41943041}));
});

async function createAsset(f,{actor='jon',type='application/pdf',name='brief.pdf',extra={}}={}){
 await f.actor(actor);const id=crypto.randomUUID();
 const upload={id,key:'northside-marketing/'+id,name,type,size:12,collection:'jons-content',title:'Auction brief',note:'Use for the reminder.',createdAt:'2000-01-01T00:00:00Z',uploadedBy:'steve',...extra};
 await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['upload',id,JSON.stringify(upload)]);
 const pending=await f.get(id,'upload');
 await f.db.exec('reset role');await f.db.query("insert into storage.objects values(gen_random_uuid(),$1,'marketing-assets',$2::jsonb)",[pending.key,JSON.stringify({size:12,mimetype:type})]);
 await f.actor(actor);await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['asset',id,JSON.stringify(pending)]);
 return {id,pending};
}
async function assign(f,id,version,project='',deliverable=''){return (await f.db.query('select hub_assign_asset($1,$2,$3,$4) result',[id,version,project,deliverable])).rows[0].result;}

test('staff assignment of Jon’s video preserves one asset, one storage object and the original upload metadata',async()=>{
 const f=await auctionDb({numbered:true});try{
  const {id,pending}=await createAsset(f,{type:'video/mp4',name:'reminder.mp4'});
  const original=await f.get(id,'asset');
  await f.db.exec('reset role');
  const beforeFiles=(await f.db.query('select * from storage.objects order by id')).rows;
  const beforeIds=(await f.db.query("select id from marketing_records where kind='asset' order by id")).rows;
  await f.actor('outsider');
  const saved=await assign(f,id,0,'weekly','mj-24');
  assert.equal(saved.id,id);assert.equal(saved.data.assignedBy,'outsider');assert.ok(saved.data.assignedAt);
  assert.equal(saved.data.assignedProjectId,'weekly');assert.equal(saved.data.assignedDeliverableId,'mj-24');
  for(const field of Object.keys(original))if(!field.startsWith('assign'))assert.deepEqual(saved.data[field],original[field],field);
  await assign(f,id,0,'weekly','mj-24');
  await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['asset',id,JSON.stringify(pending)]);
  assert.deepEqual(await f.get(id,'asset'),saved.data);
  await f.db.exec('reset role');
  assert.deepEqual((await f.db.query('select * from storage.objects order by id')).rows,beforeFiles);
  assert.deepEqual((await f.db.query("select id from marketing_records where kind='asset' order by id")).rows,beforeIds);
  assert.equal(beforeFiles.filter(file=>file.name===pending.key).length,1);assert.equal(beforeIds.filter(asset=>asset.id===id).length,1);
 }finally{await f.db.close();}
});

test('upload → assign → change → clear is staff-authorized, scoped, audited and retry safe',async()=>{
 const f=await auctionDb();try{
  const beforeProject=await f.get('weekly','project'),beforeDeliverable=await f.get('mj-48');
  const {id,pending}=await createAsset(f);
  assert.equal(pending.uploadedBy,'jon');assert.notEqual(pending.createdAt,'2000-01-01T00:00:00Z');assert.equal(pending.uploadedAt,pending.createdAt);
  assert.equal((await f.get(id,'asset')).assignedProjectId,undefined);
  const first=await assign(f,id,0,'weekly','mj-48');assert.equal(first.data.assignedBy,'jon');assert.ok(first.data.assignedAt);assert.equal(first.data.assignmentVersion,1);
  await f.actor('outsider'); // Ordinary staff, with no project membership, may assign content.
  const changed=await assign(f,id,1,'weekly','mj-24');assert.equal(changed.data.assignedBy,'outsider');assert.equal(changed.data.uploadedBy,'jon');assert.equal(changed.data.assignmentVersion,2);
  assert.deepEqual((await assign(f,id,1,'weekly','mj-24')).data,changed.data,'lost response retry preserves actor/time/version');
  await assert.rejects(assign(f,id,1,'weekly','mj-2'),/assignment changed/);
  await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['asset',id,JSON.stringify(pending)]);
  assert.deepEqual(await f.get(id,'asset'),changed.data,'finalization retry cannot erase assignments');
  await assert.rejects(assign(f,id,2,'missing','mj-24'),/selected project/);
  await assert.rejects(assign(f,id,2,'missing'),/available project/);
  await assert.rejects(assign(f,id,2,'','missing'),/available deliverable/);
  await f.actor('steve');const cleared=await assign(f,id,2);assert.equal(cleared.data.assignedProjectId,'');assert.equal(cleared.data.assignedDeliverableId,'');assert.equal(cleared.data.assignedBy,'steve');assert.equal(cleared.data.assignmentVersion,3);
  assert.deepEqual(await f.get('weekly','project'),beforeProject);assert.deepEqual(await f.get('mj-48'),beforeDeliverable);
  await f.actor('foreign');assert.equal(await f.get(id,'asset'),undefined);await assert.rejects(assign(f,id,3,'weekly'),/not found/);
  await f.actor('unsigned');await assert.rejects(assign(f,id,3,'weekly'));
  await f.db.exec('reset role');
  const privileges=(await f.db.query("select has_function_privilege('anon','public.hub_assign_asset(text,integer,text,text)','execute') anon, has_function_privilege('authenticated','public.hub_assign_asset(text,integer,text,text)','execute') staff")).rows[0];
  assert.deepEqual(privileges,{anon:false,staff:true});
  await f.actor('');await assert.rejects(assign(f,id,3,'weekly'),/Staff access/);
  await f.db.exec('reset role;set role anon');await assert.rejects(assign(f,id,3,'weekly'),/permission denied/);
 }finally{await f.db.close();}
});

test('direct upload RPC rejects forged assignment data, invalid metadata and incomplete files; migration is repeatable',async()=>{
 const f=await auctionDb();try{
  await f.actor('jon');
  for(const extra of [{assignedProjectId:'weekly'},{collection:'another'},{note:'x'.repeat(501)},{title:null},{name:null}])await assert.rejects(createAsset(f,{extra}),/upload details/);
  const {id,pending}=await createAsset(f,{type:'image/svg+xml',name:'graphic.svg'});
  const assigned=await assign(f,id,0,'weekly');
  await f.db.exec('reset role');const migration=await readFile(new URL('../supabase/migrations/20260924032636_jons_content_assignments.sql',import.meta.url),'utf8');await f.db.exec(migration);await f.db.exec(migration);
  await f.actor('jon');assert.deepEqual(await f.get(id,'asset'),assigned.data);
  const bad=crypto.randomUUID(),upload={...pending,id:bad,key:'northside-marketing/'+bad};
  await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['upload',bad,JSON.stringify(upload)]);
  const badPending=await f.get(bad,'upload');await assert.rejects(f.db.query('select hub_save_record($1,$2,$3::jsonb)',['asset',bad,JSON.stringify(badPending)]),/must finish/);
 }finally{await f.db.close();}
});

test('deliverable assignment derives the correct project and rejects deleted or cross-org work',async()=>{
 const f=await auctionDb();try{
  const {id}=await createAsset(f);const a=await assign(f,id,0,'','mj-48');assert.equal(a.data.assignedProjectId,'weekly');
  await f.db.exec("reset role;update marketing_records set data=data||'{\"deletedAt\":\"2026-09-24T00:00:00Z\"}'::jsonb where id='mj-2'");
  await f.actor('jon');await assert.rejects(assign(f,id,1,'','mj-2'),/available deliverable/);
  await f.db.exec("reset role;insert into marketing_records(workspace_id,kind,id,data) values('other-org','project','foreign-project','{\"title\":\"Other company\",\"owner\":\"foreign\"}'),('other-org','deliverable','foreign-work','{\"projectId\":\"foreign-project\"}')");
  await f.actor('jon');await assert.rejects(assign(f,id,1,'foreign-project'),/available project/);await assert.rejects(assign(f,id,1,'','foreign-work'),/available deliverable/);
 }finally{await f.db.close();}
});


test('assignment destinations open the correct tab and focus the exact deliverable',()=>{
 assert.equal(assetProjectHref('weekly'),'/projects/weekly?tab=assets');
 assert.equal(assetDeliverableHref('mj-48',{projectId:'weekly'}),'/projects/weekly?tab=deliverables&deliverable=mj-48#deliverable-mj-48');
 assert.equal(assetDeliverableHref('task 1',{projectId:'launch'}),'/projects/launch?tab=deliverables&deliverable=task%201#deliverable-task%201');
 assert.equal(assetDeliverableHref('standalone',{projectId:''}),'/projects/work/standalone');
});
