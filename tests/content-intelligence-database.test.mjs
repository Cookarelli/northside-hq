import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {auctionDb} from './helpers/auction-db.mjs';
let db,actor;
const admin='10000000-0000-4000-8000-000000000002';
async function run(action,p={}){return (await db.query('select hub_intelligence($1,$2::jsonb) result',[action,JSON.stringify(p)])).rows[0].result;}
async function service(action,p={},who=admin){await db.exec('reset role;set role service_role');return (await db.query('select hub_intelligence_sync($1,$2,$3::jsonb) result',[who,action,JSON.stringify({pageId:'123',platform:'facebook',mode:'history',...p})])).rows[0].result;}
async function expire(mode='history'){await db.exec('reset role');await db.query("update private.intelligence_sync_state set retry_at=null,lease_until=now()-interval '1 minute' where mode=$1",[mode]);}
before(async()=>{
 ({db,actor}=await auctionDb());await db.exec('reset role');
 await db.query("insert into meta_connections(org_id,page_id,name,instagram_id,connected_by) values('northside-marketing','123','Test Page','456',$1)",[admin]);
 await db.query("insert into private.meta_credentials values('northside-marketing','page:123',$1,null)",['encrypted-fixture-credential-no-real-secret']);
});
after(async()=>await db.close());
test('new tables are organization scoped; credentials, leases and manual sync cannot be reached by browser roles',async()=>{
 await actor('steve');await assert.rejects(db.query('select * from private.intelligence_sync_state'),/permission denied/);
 await assert.rejects(db.query("select hub_intelligence_sync($1,'claim','{}')",[admin]),/permission denied/);
 await assert.rejects(db.exec("insert into intelligence_reports values('northside-marketing',gen_random_uuid(),'daily',current_date,'{}',now(),null)"),/permission denied/);
 await db.exec('reset role;set role anon');for(const table of ['intelligence_reports','intelligence_labels','meta_analytics_snapshots','intelligence_sync_runs'])await assert.rejects(db.query('select * from '+table),/permission denied/);
 await assert.rejects(service('claim',{},'10000000-0000-4000-8000-000000000003'),e=>e.code==='42501');
 await assert.rejects(service('claim',{},'10000000-0000-4000-8000-000000000007'),/Agreement/);
});
test('cursor leases reject concurrent claims, expired completions, replay and untrusted actors',async()=>{
 const a=await service('claim');assert.ok(a.token);const b=await service('claim');assert.equal(b.skipped,true);assert.equal(b.ciphertext,undefined);
 await assert.rejects(service('finish',{token:crypto.randomUUID(),posts:[]}),/no rows/);
 await expire();await assert.rejects(service('finish',{token:a.token,posts:[]}),/no rows/);
 const c=await service('claim');assert.notEqual(c.token,a.token);
 await service('finish',{token:c.token,posts:[{id:'123_10',caption:'Historical post',url:'https://facebook.com/123/posts/10',publishedAt:'2026-10-15T12:00:00Z',mediaIds:[],mediaType:'PHOTO',verifiedAt:'2026-10-16T12:00:00Z'}],after:'opaque-next'});
 await assert.rejects(service('finish',{token:c.token,posts:[]}),/no rows/);
 await expire();const d=await service('claim');assert.equal(d.after,'opaque-next');
 await service('finish',{token:d.token,error:'meta_rate_limited'});assert.equal((await service('claim')).skipped,true);
 await expire();const e=await service('claim');assert.equal(e.after,'opaque-next');await service('finish',{token:e.token,posts:[],after:null});assert.equal((await service('claim')).complete,true);
 await actor('steve');const states=(await db.query('select status,error_code from intelligence_sync_runs')).rows;assert.ok(states.some(s=>s.status==='interrupted'));assert.ok(states.some(s=>s.error_code==='meta_rate_limited'));
});
test('incremental imports preserve IDs, credentials and worker state; insight snapshots remain historical',async()=>{
 const c=await service('claim',{mode:'current'});await service('finish',{mode:'current',token:c.token,posts:[{id:'123_10',caption:'Updated caption',url:'https://facebook.com/123/posts/10',publishedAt:'2026-10-15T12:00:00Z',mediaIds:[],mediaType:'PHOTO',verifiedAt:'2026-10-16T12:00:00Z'}],after:null});
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from meta_imports')).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from social_tasks')).rows[0].n,0);
 for(const views of [0,12]){await expire('metrics');const lease=await service('claim',{mode:'metrics'});assert.equal(lease.posts[0].external_id,'123_10');await service('finish',{mode:'metrics',token:lease.token,snapshots:[{id:'123_10',metrics:{views,reach:null},unavailable:['reach']}],after:null});}
 await actor('jon');const snapshots=(await db.query('select metrics from meta_analytics_snapshots order by observed_at')).rows;assert.equal(snapshots.length,2);assert.equal(snapshots[0].metrics.views,0);assert.equal(snapshots[1].metrics.views,12);
 await actor('foreign');assert.equal((await db.query('select * from meta_analytics_snapshots')).rows.length,0);
});
test('shared-adapter observations append snapshots without modifying its latest-row contract',async()=>{
 await db.exec('reset role');await db.exec("insert into meta_insights values('northside-marketing','123','123_10','post','{\"post_media_view\":{\"values\":[{\"value\":15}]}}','{}',now())");
 await db.exec("update meta_insights set observed_at=now()+interval '1 second',metrics='{\"post_media_view\":{\"values\":[{\"value\":19}]}}'");
 assert.equal((await db.query("select count(*)::int n from meta_analytics_snapshots where format='meta'")).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from meta_insights')).rows[0].n,1);
});
test('staff attribution uses real same-workspace campaigns and optimistic locking',async()=>{
 await actor('jon');const p={pageId:'123',platform:'facebook',externalId:'123_10',version:0,category:'Auctions',template:'community-source',campaignId:'weekly',campaignKind:'project'};await run('label',p);
 await assert.rejects(run('label',p),/changed/);await assert.rejects(run('label',{...p,version:1,campaignId:'not-real'}),/existing/);
 await run('label',{...p,version:1,category:'Sports'});await actor('foreign');await assert.rejects(run('label',{...p,version:2}));
});
test('campaign spending mappings are explicit, unique, versioned and organization scoped',async()=>{
 await db.exec('reset role');
 await db.exec(`insert into marketing_records(workspace_id,kind,id,data) values
 ('northside-marketing','campaign','weekly','{"name":"Fixture campaign"}'),
 ('northside-marketing','metrics','fixture-spend','{"date":"2026-10-16","campaign":"auction-245","source":"facebook","spend":20}')`);
 await actor('jon');const p={campaignId:'weekly',campaignKind:'project',reportingKey:'auction-245',version:0};
 await assert.rejects(run('campaign-link',{...p,reportingKey:'guessed'}),/saved/);
 await run('campaign-link',p);await assert.rejects(run('campaign-link',p),/changed/);
 await assert.rejects(run('campaign-link',{...p,campaignKind:'campaign'}),/unique/);
 await run('campaign-link',{...p,reportingKey:null,version:1});await run('campaign-link',{...p,campaignKind:'campaign'});
 await actor('foreign');assert.equal((await db.query('select * from intelligence_campaign_links')).rows.length,0);await assert.rejects(run('campaign-link',{...p,version:2}));
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from intelligence_campaign_links'),/permission denied/);
});
test('read-only post view inherits source RLS and bounds captions',async()=>{
 await db.exec('reset role');await db.query("update meta_imports set caption=$1 where external_id='123_10'",['x'.repeat(900)]);
 await actor('jon');assert.equal((await db.query('select caption from intelligence_posts')).rows[0].caption.length,500);
 await assert.rejects(db.query("update intelligence_posts set url='https://example.test/changed'"),/permission denied/);
 await actor('foreign');assert.equal((await db.query('select * from intelligence_posts')).rows.length,0);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from intelligence_posts'),/permission denied/);
});
test('briefing handoff creates review/draft work once, preserving calendar and auction records',async()=>{
 await actor('steve');const id=crypto.randomUUID(),idea={id:'idea',itemId:null,headline:'A reviewable content experiment',sourceUrl:'https://facebook.com/123/posts/10',whyToday:'Three measured posts support a small editorial test.',template:'collector-question',facebook:'What would you collect next?',instagram:'What would you collect next?',checks:['Verify a source and owned asset.']};
 await run('report',{id,kind:'daily',data:{ideas:[idea],notes:['Fixture']}});await run('report',{id,kind:'daily',data:{ideas:[],notes:[]}});
 assert.equal((await db.query('select data from intelligence_reports where id=$1',[id])).rows[0].data.ideas.length,1);
 const p={reportId:id,ideaId:'idea',calendar:true,date:'2099-01-02T11:00'};
 const before=(await db.query("select count(*)::int n from marketing_records where kind='deliverable'")).rows[0].n;
 const a=await run('handoff',p);assert.equal((await db.query("select data->>'status' status from marketing_records where id=$1",[a.calendarId])).rows[0].status,'draft');
 await db.exec('reset role');await db.query("update marketing_records set data=data||'{\"caption\":\"Human edits\"}' where id=$1",[a.calendarId]);await actor('steve');
 const b=await run('handoff',p);assert.equal(a.queueId,b.queueId);assert.equal((await db.query("select data->>'caption' caption from marketing_records where id=$1",[a.calendarId])).rows[0].caption,'Human edits');
 assert.equal((await db.query("select count(*)::int n from marketing_records where kind='deliverable'")).rows[0].n,before);
 assert.equal((await db.query("select data->>'state' state from radar_editorial where id=$1",[a.queueId])).rows[0].state,'Needs review');
 await actor('foreign');assert.equal((await db.query('select * from intelligence_reports')).rows.length,0);await assert.rejects(run('handoff',p));
 await actor('unsigned');await assert.rejects(run('report',{id:crypto.randomUUID(),kind:'daily',data:{ideas:[]}}),/Agreement/);
});
test('source controls preserve existing IDs and successful cadence while fencing changed settings',async()=>{
 await actor('steve');const id=crypto.randomUUID(),settings={name:'Publisher',url:'https://www.dacardworld.com/blog/',category:'Baseball',priority:'high',enabled:true,mode:'discover',cadenceMinutes:10080,allowPage:true,permissionNote:'Written publisher permission',feedUrl:''};
 await db.query("select hub_radar('add-source',$1)",[JSON.stringify({id,data:settings})]);await db.query("select hub_radar('edit-source',$1)",[JSON.stringify({id,data:settings})]);
 const lease=(await db.query("select hub_radar('acquire-source',$1) result",[JSON.stringify({id})])).rows[0].result;assert.equal(lease.source.cadence_minutes,10080);
 await db.query("select hub_radar('finish-source',$1)",[JSON.stringify({sourceId:id,token:lease.token,runId:lease.runId,version:lease.source.config_version,data:{status:'success',cursor:null}})]);
 const next=(await db.query('select extract(epoch from(next_attempt::timestamptz-now())) seconds from radar_sources where id=$1',[id])).rows[0].seconds;assert.ok(Number(next)>6*86400);
 await assert.rejects(db.query("select hub_radar('edit-source',$1)",[JSON.stringify({id,data:{...settings,permissionNote:''}})]),/permission/);
 await assert.rejects(db.query("select private.radar_before_intelligence('edit-source',$1)",[JSON.stringify({id,data:settings})]),/permission denied/);
});
