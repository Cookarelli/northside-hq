import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mediaApi} from './helpers/media-api.mjs';
import {auctionDb} from './helpers/auction-db.mjs';
import {blankDeliverable,blankProject,deliverableDraft} from '../lib/hq-model.ts';
import {mediaStatus,canReviewMedia,needsMediaReview} from '../lib/media-review.ts';
import {jonAssetIds,assignedAssetIds} from '../lib/hq-assets.ts';
let f;
before(async()=>{
 f=await auctionDb();await f.db.exec('reset role');
 for(const [id,suffix] of [['nick','90'],['nikb','91']]){
  await f.db.query("insert into auth.users values($1,$2,now())",['10000000-0000-4000-8000-0000000000'+suffix,id+'@example.test']);
  await f.db.query("insert into private.staff_access(email,org_id,id,name,role) values($1,'northside-marketing',$2,$3,'staff')",[id+'@example.test',id,id==='nick'?'Nick':'Nik']);
 }
 const original=f.actor;
 f.actor=async name=>{
  if(!['nick','nikb'].includes(name))return original(name);
  await f.db.exec('reset role');await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",['10000000-0000-4000-8000-0000000000'+(name==='nick'?'90':'91')]);await f.db.exec('set role authenticated');
 };
 for(const name of ['nick','nikb']){await f.actor(name);await f.db.query('select hub_agreement_gate()');await f.db.query('select hub_accept_agreement($1,$2,$3,$4)',['20000000-0000-4000-8000-000000000001',name==='nick'?'Nick':'Nik','','test']);}
});
after(async()=>await f?.db.close());
async function upload({actor='jon',destination={},extra={}}={}){
 await f.actor(actor);const id=crypto.randomUUID();
 await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['upload',id,JSON.stringify({id,key:'northside-marketing/'+id,name:'photo.png',type:'image/png',size:12,...destination,...extra})]);
 const pending=await f.get(id,'upload');
 await f.db.exec('reset role');await f.db.query("insert into storage.objects values(gen_random_uuid(),$1,'marketing-assets','{\"size\":12,\"mimetype\":\"image/png\"}')",[pending.key]);
 await f.actor(actor);await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['asset',id,JSON.stringify(pending)]);
 return {id,pending,data:await f.get(id,'asset')};
}
async function review(id,action,deliverable='',version,note=''){
 return (await f.db.query('select hub_review_media($1,$2,$3,$4,$5) result',[id,version??(await f.get(id,'asset'))?.mediaReview?.version??0,action,deliverable,note])).rows[0].result.data;
}
async function work(id,assets=[]){await f.actor('steve');return (await f.hq('save-deliverable',{id,version:0,data:{...blankDeliverable,title:id,instructions:'Check the final photos before posting.',owner:'jon',contributors:['brody'],projectId:'weekly',productionDue:'2026-09-20T19:00',publishAt:'2026-09-20T19:00',format:'Photo',caption:'Auction reminder',publisher:'steve',assets,assetRoles:Object.fromEntries(assets.map(a=>[a,'final']))}})).data;}
async function advance(id,action,extra={}){return (await f.hq(action,{id,version:(await f.get(id)).version,...extra})).data;}
async function approveWork(id){await f.actor('steve');await advance(id,'production',{status:'in_progress'});await advance(id,'production',{status:'needs_review'});return advance(id,'review',{decision:'approve',comment:'Package checked.'});}
async function publish(id,platform,status='published'){return advance(id,'publication',{platform,status,confirmed:true,time:'2026-09-20T19:00',url:status==='published'?'https://example.test/'+id+'/'+platform:'',unavailableReason:''});}

test('four media labels use authenticated Jon identity; collection and assignments are not stages',()=>{
 const data={uploadedBy:'jon',type:'image/png'};
 for(const [status,label] of Object.entries({in_review:'In Review',approved:'Approved',waiting:'Waiting',completed:'Completed'}))assert.equal(mediaStatus({...data,mediaReview:{status,version:1}}),label);
 assert.equal(mediaStatus({...data,assignedProjectId:'weekly'}),'In Review');
 assert.equal(needsMediaReview({collection:'jons-content',uploadedBy:'brody',type:'video/mp4'}),false);
 assert.equal(needsMediaReview({owner:'jon',type:'video/mp4'}),true);
 assert.equal(needsMediaReview({owner:'jon',uploadedBy:'steve',type:'image/png'}),false);
 assert.equal(mediaStatus({...data,type:'application/pdf'}),null);
 for(const id of ['joey','steve','brody','nick'])assert.equal(canReviewMedia(id),true);
 for(const id of ['jon','nik','nikb','outsider'])assert.equal(canReviewMedia(id),false);
});
test('direct upload attaches atomically to the exact work and parent; retries preserve provenance and review',async()=>{
 const {id,pending,data}=await upload({destination:{uploadDeliverableId:'mj-48'},extra:{uploadedBy:'steve',createdAt:'2000-01-01'}});
 assert.equal(data.uploadedBy,'jon');assert.equal(data.assignedProjectId,'weekly');assert.equal(data.assignedDeliverableId,'mj-48');assert.equal(data.assignedBy,'jon');assert.equal(mediaStatus(data),'In Review');
 const records=(await f.db.query("select kind,id,data from marketing_records where kind='asset'")).rows;
 assert.ok(jonAssetIds(records).has(id));assert.ok(assignedAssetIds(records,'deliverable','mj-48').includes(id));
 await f.actor('nick');const approved=await review(id,'approve','',undefined,'Use the landscape crop.');
 assert.equal(approved.mediaReview.status,'approved');assert.equal(approved.mediaReview.approval.by,'nick');assert.ok(approved.mediaReview.approval.at);
 await f.actor('jon');await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['asset',id,JSON.stringify(pending)]);
 assert.deepEqual(await f.get(id,'asset'),approved);
 const project=await upload({destination:{uploadProjectId:'weekly'}});assert.equal(project.data.assignedProjectId,'weekly');assert.equal(project.data.assignedDeliverableId,'');
 await assert.rejects(upload({destination:{uploadProjectId:'missing'}}),/available project/);
 await assert.rejects(upload({destination:{uploadProjectId:'other',uploadDeliverableId:'mj-48'}}),/selected project/);
 for(const extra of [{mediaReview:{status:'approved'}},{assignedDeliverableId:'mj-2'},{uploadProjectId:null}])await assert.rejects(upload({extra}),/upload/);
 const rows=(await f.db.query("select id from marketing_records where kind='deliverable'")).rows;assert.equal(rows.length,3,'uploading never creates work');
 await f.db.exec('reset role');assert.equal((await f.db.query('select count(*) n from storage.objects where name=$1',[pending.key])).rows[0].n,1);
 assert.ok((await f.db.query("select action from hq_activity where kind='asset' and record_id=$1",[id])).rows.some(r=>r.action==='media assigned'));
});

test('only the four actual reviewer accounts can approve through the public RPC, without admin promotion',async()=>{
 for(const actor of ['joey','steve','brody','nick']){
  const a=await upload();await f.actor(actor);const approved=await review(a.id,'approve');
  assert.equal(approved.mediaReview.approval.by,actor);assert.equal(approved.mediaReview.approval.assetId,a.id);assert.equal(approved.mediaReview.status,'approved');
  await assert.rejects(review(a.id,'approve','',0),/changed/);
 }
 const a=await upload();
 for(const actor of ['jon','nikb','outsider']){await f.actor(actor);await assert.rejects(review(a.id,'approve'),/Only Joey/);await assert.rejects(review(a.id,'completed'),/Completion requires/);}
 await f.actor('foreign');await assert.rejects(review(a.id,'approve','',0),/Choose a photo/);
 await f.actor('unsigned');await assert.rejects(review(a.id,'approve','',0),/agreement/i);
 await f.db.exec("reset role;update private.staff_access set active=false where id='nick'");await f.actor('nick');await assert.rejects(review(a.id,'approve','',0));
 await f.db.exec("reset role;update private.staff_access set active=true where id='nick'");
 assert.deepEqual((await f.db.query("select id,role from private.staff_access where id in ('brody','nick') order by id")).rows,[{id:'brody',role:'staff'},{id:'nick',role:'staff'}]);
 const privileges=(await f.db.query("select has_function_privilege('anon','public.hub_review_media(text,integer,text,text,text)','execute') anon,has_table_privilege('authenticated','public.marketing_records','update') direct")).rows[0];assert.deepEqual(privileges,{anon:false,direct:false});
 await f.actor('');await assert.rejects(review(a.id,'approve','',0),/Staff access/);
 await f.db.exec('reset role;set role anon');await assert.rejects(review(a.id,'approve','',0),/permission denied/);
});

test('Approved remains visible; Waiting uses existing publishing access; all-platform publication completes only exact final media',async()=>{
 const final=await upload(),reference=await upload(),unrelated=await upload();await work('media-publish',[final.id]);await work('media-other',[unrelated.id]);
 await f.actor('steve');await f.db.query('select hub_assign_asset($1,0,$2,$3)',[final.id,'weekly','media-publish']);await f.db.query('select hub_assign_asset($1,0,$2,$3)',[reference.id,'weekly','media-publish']);
 await assert.rejects(review(final.id,'waiting','media-publish'),/Approve this media/);
 await advance('media-publish','production',{status:'in_progress'});await advance('media-publish','production',{status:'needs_review'});
 await assert.rejects(advance('media-publish','review',{decision:'approve',comment:''}),/media approval/);
 await f.actor('brody');await review(final.id,'approve','',undefined,'Approved crop');assert.equal((await f.get(final.id,'asset')).mediaReview.status,'approved');
 await f.actor('steve');await advance('media-publish','review',{decision:'approve',comment:''});
 await assert.rejects(publish('media-publish','facebook'),/Mark the approved media Waiting/);
 await f.actor('nick');await assert.rejects(review(final.id,'waiting','media-publish'),/manage publishing/);
 await f.actor('outsider');await assert.rejects(review(final.id,'waiting','media-publish'),/manage publishing/);
 await f.actor('steve');await assert.rejects(review(final.id,'waiting','media-other'),/associated publishing/);await review(final.id,'waiting','media-publish');
 await publish('media-publish','facebook','scheduled');assert.equal((await f.get(final.id,'asset')).mediaReview.status,'waiting');
 await publish('media-publish','facebook');assert.equal((await f.get(final.id,'asset')).mediaReview.status,'waiting');
 await publish('media-publish','instagram');const completed=await f.get(final.id,'asset');assert.equal(completed.mediaReview.status,'completed');assert.equal(completed.mediaReview.completed.deliverableId,'media-publish');
 assert.equal((await f.get(reference.id,'asset')).mediaReview.status,'in_review');assert.equal((await f.get(unrelated.id,'asset')).mediaReview.status,'in_review');assert.equal((await f.get('media-other')).status,'to_do');assert.equal((await f.get('weekly','project')).status,'active');
 assert.equal(completed.mediaReview.approval.note,'Approved crop');
 await f.db.query('select hub_assign_asset($1,$2,$3,$4)',[final.id,completed.assignmentVersion,'weekly','media-other']);assert.equal((await f.get(final.id,'asset')).mediaReview.status,'approved','old publication does not complete the new destination');
 const history=(await f.db.query("select snapshot from hq_activity where record_id=$1 and action='previous media assignment'",[final.id])).rows;assert.ok(history.some(r=>r.snapshot.mediaReview.status==='completed'));
});

test('replacement bytes require a new immutable asset and a fresh media review',async()=>{
 const old=await upload();await work('media-replace',[old.id]);await f.actor('joey');await review(old.id,'approve');await approveWork('media-replace');
 const replacement=await upload({destination:{uploadDeliverableId:'media-replace'}});assert.equal(replacement.data.mediaReview.status,'in_review');
 await f.actor('steve');const d=await f.get('media-replace');await f.hq('save-deliverable',{id:'media-replace',version:d.version,data:{...deliverableDraft(d),assets:[replacement.id],assetRoles:{[replacement.id]:'final'}}});
 await advance('media-replace','production',{status:'needs_review'});await assert.rejects(advance('media-replace','review',{decision:'approve',comment:''}),/media approval/);
 await f.actor('jon');await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['asset',replacement.id,JSON.stringify({...replacement.pending,mediaReview:{status:'approved',approval:{by:'joey',assetId:replacement.id}}})]);
 assert.equal((await f.get(replacement.id,'asset')).mediaReview.status,'in_review','forged finalization cannot replace canonical metadata');
 await assert.rejects(f.db.query('select hub_save_record($1,$2,$3::jsonb)',['upload',old.id,JSON.stringify({...old.pending,name:'replacement.png'})]),/immutable/);
 assert.equal((await f.get(old.id,'asset')).mediaReview.status,'approved');
 await f.actor('nick');await review(replacement.id,'approve');await f.actor('steve');await advance('media-replace','review',{decision:'approve',comment:''});
});

test('real API routes enforce origin, identity, payload, reviewer and version checks',async()=>{
 const api=await mediaApi(f);
 try{
  await f.actor('jon');
  const input={name:'direct.png',type:'image/png',size:12,uploadDeliverableId:'mj-2'};
  assert.equal((await api.post('upload',input,'','https://other.example.test')).status,403);
  api.signedIn(false);assert.equal((await api.post('upload',input)).status,401);api.signedIn(true);
  assert.equal((await api.post('upload',{...input,uploadedBy:'joey'})).status,400);
  const ticket=await api.post('upload',input);assert.equal(ticket.status,200);
  assert.equal((await api.post('finalize',{id:ticket.body.id})).status,503,'unfinished transfers cannot create assets');
  const pending=await f.get(ticket.body.id,'upload');await f.db.exec('reset role');await f.db.query("insert into storage.objects values(gen_random_uuid(),$1,'marketing-assets','{\"size\":12,\"mimetype\":\"image/png\"}')",[pending.key]);await f.actor('jon');
  const saved=await api.post('finalize',{id:ticket.body.id});assert.equal(saved.status,200);assert.equal(saved.body.asset.assignedDeliverableId,'mj-2');assert.equal(saved.body.asset.uploadedBy,'jon');
  assert.equal((await api.post('review',{version:0,action:'approve',by:'joey'},ticket.body.id)).status,400);
  for(const actor of ['jon','nikb','outsider']){await f.actor(actor);assert.equal((await api.post('review',{version:0,action:'approve'},ticket.body.id)).status,403);}
  for(const actor of ['joey','steve','brody','nick']){
   const a=await upload();await f.actor(actor);const response=await api.post('review',{version:0,action:'approve'},a.id);assert.equal(response.status,200);assert.equal(response.body.data.mediaReview.approval.by,actor);
   assert.equal((await api.post('review',{version:0,action:'approve'},a.id)).status,409);
   assert.equal((await api.post('review',{version:1,action:'completed'},a.id)).status,400);
  }
 }finally{api.close();}
});

test('backfill uses reliable current-version approvals/publication evidence, preserves notes, and is repeatable',async()=>{
 const ids={none:crypto.randomUUID(),approved:crypto.randomUUID(),completed:crypto.randomUUID(),partial:crypto.randomUUID(),wrong:crypto.randomUUID(),completedLegacy:crypto.randomUUID()};
 await f.db.exec('reset role;alter table marketing_records disable trigger hq_media_publication_guard;alter table marketing_records disable trigger hq_media_completion');
 const at='2026-09-20T19:00:00-05:00';
 for(const [state,id] of Object.entries(ids)){
  await f.db.query("insert into marketing_records(workspace_id,kind,id,data) values('northside-marketing','asset',$1,$2)",[id,JSON.stringify({id,name:state+'.png',type:'image/png',uploadedBy:'jon',uploadedAt:at,note:'Preserved upload note'})]);
  const approval={by:['wrong','completedLegacy'].includes(state)?'nikb':'brody',at,contentVersion:1,comment:'Preserved review note',package:{finalAssets:[id]}};
  const proof={status:'published',publishedAt:at,recordedAt:at,recordedBy:'steve',liveUrl:'https://example.test/posted',approval};
  const data={...blankDeliverable,contentVersion:1,assets:[id],assetRoles:{[id]:'final'},approval:['none','completedLegacy'].includes(state)?null:approval,publications:['completed','completedLegacy'].includes(state)?{facebook:proof,instagram:proof}:state==='partial'?{facebook:proof}: {},status:'done'};
  await f.db.query("insert into marketing_records(workspace_id,kind,id,data) values('northside-marketing','deliverable',$1,$2)",['legacy-'+state,JSON.stringify(data)]);
 }
 await f.db.exec('alter table marketing_records enable trigger hq_media_publication_guard;alter table marketing_records enable trigger hq_media_completion');
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 const migration=await readFile(new URL('../supabase/migrations/20260924183335_direct_media_review.sql',import.meta.url),'utf8');await f.db.exec(migration);
 assert.equal((await f.get(ids.none,'asset')).mediaReview.status,'in_review');assert.equal((await f.get(ids.wrong,'asset')).mediaReview.status,'in_review');assert.equal((await f.get(ids.partial,'asset')).mediaReview.status,'approved');
 const approved=await f.get(ids.approved,'asset');assert.equal(approved.mediaReview.approval.at,at);assert.equal(approved.mediaReview.approval.by,'brody');assert.equal(approved.mediaReview.approval.note,'Preserved review note');assert.equal(approved.note,'Preserved upload note');
 assert.equal((await f.get(ids.completed,'asset')).mediaReview.status,'completed');
 const legacy=await f.get(ids.completedLegacy,'asset');assert.equal(legacy.mediaReview.status,'completed');assert.equal(legacy.mediaReview.approval,undefined,'publication evidence preserves completed work without fabricating media approval');
 await f.actor('steve');
 await f.db.query('select hub_assign_asset($1,0,$2,$3)',[ids.completedLegacy,'','legacy-completedLegacy']);
 assert.equal((await f.get(ids.completedLegacy,'asset')).mediaReview.status,'completed','assigning a completed legacy file to its recorded destination retains completion');
 await f.hq('save-project',{id:'new-media-project',version:0,data:{...blankProject,title:'Unrelated project',brief:'Separate media assignment.',owner:'steve'}});
 await f.db.query('select hub_assign_asset($1,1,$2,$3)',[ids.completedLegacy,'new-media-project','']);
 assert.equal((await f.get(ids.completedLegacy,'asset')).mediaReview.status,'in_review','moving the destination cannot inherit unrelated publication or fabricate approval');
 await f.db.exec('reset role');await f.db.query('select private.sync_media_completion($1,$2)',['northside-marketing',ids.completedLegacy]);
 assert.equal((await f.get(ids.completedLegacy,'asset')).mediaReview.status,'in_review');
 const before=(await f.db.query('select * from marketing_records order by workspace_id,kind,id')).rows;await f.db.exec(migration);assert.deepEqual((await f.db.query('select * from marketing_records order by workspace_id,kind,id')).rows,before);
});
