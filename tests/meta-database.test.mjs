import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {auctionDb} from './helpers/auction-db.mjs';
import {contentHash} from '../lib/meta/core.ts';
let db,actor;
const admin='10000000-0000-4000-8000-000000000002',staff='10000000-0000-4000-8000-000000000003';
async function service(action,payload={},who=admin){await db.exec('reset role;set role service_role');return (await db.query('select hub_meta_service($1,$2,$3::jsonb) result',[who,action,JSON.stringify(payload)])).rows[0].result;}
before(async()=>{({db,actor}=await auctionDb());});
after(async()=>await db.close());
test('Meta credentials and service broker are inaccessible to browser roles; staff/agreement gates still apply',async()=>{
 await actor('steve');await assert.rejects(db.query('select * from private.meta_credentials'),/permission denied/);await assert.rejects(db.query("select hub_meta_service($1,'user-token','{}')",[admin]),/permission denied/);
 await assert.rejects(service('user-token',{},staff),/administrators/);await assert.rejects(service('user-token',{},'10000000-0000-4000-8000-000000000007'),/Agreement/);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from meta_connections'),/permission denied/);
});
test('OAuth state is actor-bound, expiring and consumed exactly once',async()=>{
 const hash='a'.repeat(64);await service('oauth-begin',{hash});
 await assert.rejects(service('oauth-consume',{hash},staff));await service('oauth-consume',{hash});await assert.rejects(service('oauth-consume',{hash}),/Invalid or expired/);
 await service('oauth-begin',{hash:'b'.repeat(64)});await db.exec("reset role;update private.meta_oauth_states set expires_at=now()-interval '1 minute'");await assert.rejects(service('oauth-consume',{hash:'b'.repeat(64)}),/Invalid or expired/);
});
test('connections are shared by authorized staff, isolated by org, with no ciphertext exposed',async()=>{
 await service('save-page',{pageId:'123',name:'Test Page',instagramId:'456',instagramName:'test',tasks:['ANALYZE'],scopes:['pages_show_list'],expiresAt:null,dataExpiresAt:null,ciphertext:'encrypted-fixture-not-a-real-token'});
 await actor('jon');const rows=(await db.query('select * from meta_connections')).rows;assert.equal(rows.length,1);assert.ok(!('ciphertext' in rows[0]));await assert.rejects(db.exec("update meta_connections set name='forged'"),/permission denied/);
 await actor('foreign');assert.equal((await db.query('select * from meta_connections')).rows.length,0);
});
test('Meta sync uses shared leases, rejects stale writes, imports idempotently, records missing metrics',async()=>{
 await actor('steve');await db.query("select hub_social('resume','{\"role\":\"analytics\"}')");
 const job=await service('enqueue',{pageId:'123',requestId:'91000000-0000-4000-8000-000000000001'});
 await assert.rejects(service('enqueue',{pageId:'123',requestId:'91000000-0000-4000-8000-000000000002'}),/already queued/);
 const lease=(await db.query('select hub_social_claim() result')).rows[0].result;assert.equal(lease.stage,'meta_sync');assert.equal(lease.id,job.id);
 await assert.rejects(service('finish-sync',{id:lease.id,token:'91000000-0000-4000-8000-000000000003',posts:[]}),/no rows/);
 await service('finish-sync',{id:lease.id,token:lease.token,posts:[{id:'123_9',caption:'Imported duplicate',url:'https://facebook.com/123/posts/9',publishedAt:'2026-01-01T00:00:00Z',verifiedAt:'2026-10-01T00:00:00Z',mediaIds:[],mediaType:'POST'}],complete:true});
 await assert.rejects(service('finish-sync',{id:lease.id,token:lease.token,posts:[]}),/no rows/);
 await actor('jon');assert.equal((await db.query('select count(*)::int n from meta_imports')).rows[0].n,1);
});
async function postFixture(id,caption,platform='facebook',campaign='campaign-a',asset=''){
 await db.exec('reset role');
 await actor('steve');await db.query("select hub_radar('add-item',$1::jsonb)",[JSON.stringify({id,data:{title:id,url:'https://example.test/'+id,category:'Baseball',kind:'story',priority:'normal',summary:'Test source',tags:[]}})]);await db.query("select hub_radar('verify',$1::jsonb)",[JSON.stringify({id,verification:'verified'})]);await db.exec('reset role');
 const snapshot={itemId:id,references:['https://example.test/'+id],state:'Approved',title:'Fixture '+id,facebook:caption,instagram:caption,cta:'',campaignId:campaign,assetId:asset};
 const task=(await db.query("select private.social_enqueue('northside-marketing','quality','quality',$1,'{}',$2) id",['fixture:'+id,admin])).rows[0].id;
 await db.query("insert into radar_editorial(org_id,kind,id,data,version,actor,updated_at) values('northside-marketing','queue',$1,$2,1,$3,'2026-01-01')",[id,JSON.stringify(snapshot),admin]);
 await db.query("insert into social_revisions values('northside-marketing',$1,1,$2,now())",[id,JSON.stringify(snapshot)]);
 const review=(await db.query("insert into social_reviews(org_id,queue_id,version,task_id,passed,checks) values('northside-marketing',$1,1,$2,true,'{}') returning id",[id,task])).rows[0].id;
 await db.query("insert into social_approvals(org_id,queue_id,version,review_id,actor) values('northside-marketing',$1,1,$2,$3)",[id,review,admin]);
 return (await db.query("insert into social_posts(org_id,queue_id,version,platform,scheduled_at,calendar_id) values('northside-marketing',$1,1,$2,'2099-01-01','radar_'||$1) returning id",[id,platform])).rows[0].id;
}
test('SQL fingerprint agrees with application normalization; imported and HQ content block duplicates',async()=>{
 await db.exec('reset role');const text=' Ｈello\u200b   WORLD\n';assert.equal((await db.query('select private.meta_hash($1) h',[text])).rows[0].h,contentHash(text));
 const id=await postFixture('import-duplicate','Imported duplicate');await assert.rejects(service('reserve',{pageId:'123',postId:id,requestId:'92000000-0000-4000-8000-000000000001'}),/Duplicate/);
 const hq=await postFixture('hq-duplicate','Existing HQ caption');await db.exec("insert into marketing_records(workspace_id,kind,id,data) values('northside-marketing','post','existing','{\"date\":\"2099-01-01T12:00\",\"timezone\":\"America/Chicago\",\"caption\":\"Existing HQ caption\",\"source\":\"facebook\",\"status\":\"approved\"}')");
 await assert.rejects(service('reserve',{pageId:'123',postId:hq,requestId:'92000000-0000-4000-8000-000000000002'}),/Duplicate/);
});
test('platform intents are distinct, idempotent, and database constraints prevent competing active intents',async()=>{
 const fb=await postFixture('unique-fb','Unique platform caption');
 const p={pageId:'123',postId:fb,requestId:'93000000-0000-4000-8000-000000000001'};
 const intent=await service('reserve',p);assert.equal(intent.state,'disabled');assert.equal((await service('reserve',p)).id,intent.id);
 await db.exec('reset role');
 // Same approved item, independent Instagram platform row.
 const ig=(await db.query("insert into social_posts(org_id,queue_id,version,platform,scheduled_at,calendar_id) values('northside-marketing','unique-fb',1,'instagram','2099-01-01','radar_unique-fb') returning id")).rows[0].id;
 const second=await service('reserve',{...p,postId:ig,requestId:'93000000-0000-4000-8000-000000000002'});assert.notEqual(intent.id,second.id);assert.equal(second.platform,'instagram');
 await assert.rejects(service('reserve',{...p,postId:ig}),/Idempotency/);
 await db.exec('reset role');await assert.rejects(db.query("insert into meta_intents(org_id,post_id,page_id,platform,account_id,campaign_id,content_hash,asset_ids,media_fingerprints,idempotency_key) select org_id,post_id,page_id,platform,account_id,campaign_id,content_hash,asset_ids,media_fingerprints,gen_random_uuid() from meta_intents limit 1"),/duplicate key/);
 await db.exec("update meta_connections set history_complete_at=now()-interval '1 hour'");await assert.rejects(service('reserve',p),/Synchronize/);
});
test('scheduling reuses HQ calendar, reserves disabled intent, and rejects invalidated source',async()=>{
 await db.exec("reset role;update meta_connections set history_complete_at=now()");
 await postFixture('schedule-meta','Schedule-only content');
 await db.exec("delete from social_posts where queue_id='schedule-meta'");
 await db.query("update radar_editorial set data=data||'{\"calendarDate\":\"2099-01-01T12:00\",\"calendarChannel\":\"facebook\"}' where id='schedule-meta'");
 const p={pageId:'123',queueId:'schedule-meta',version:1,platform:'facebook',scheduledAt:'2099-01-01T00:00:00Z',requestId:'94000000-0000-4000-8000-000000000001'};
 const result=await service('schedule',p);assert.equal(result.state,'disabled');
 await db.exec('reset role');assert.equal((await db.query("select count(*)::int n from marketing_records where kind='post' and id='radar_schedule-meta'")).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from social_tasks where stage='publish' and payload->>'postId'=$1",[result.post_id])).rows[0].n,1);
 await db.exec("update radar_items set verification='unverified' where id='schedule-meta'");
 await assert.rejects(service('schedule',p),/source verification/);
});
