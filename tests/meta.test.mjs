import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuration,seal,unseal,oauthURL,READ_SCOPES,contentHash} from '../lib/meta/core.ts';
import {Graph,diagnostics,METRICS} from '../lib/meta/graph.ts';
import {MetaPublicationAdapter,publicationPlan} from '../lib/meta/publishing.ts';
import {synchronize} from '../lib/meta/sync.ts';
const config={appId:'123',appSecret:'test-app-secret',version:'v26.0',redirectUri:'https://hq.test/api/meta/oauth/callback',key:Buffer.alloc(32,7)};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
test('credentials are authenticated, randomized and bound to organization and account',()=>{
 const a=seal({token:'secret'},config.key,'org:page:1'),b=seal({token:'secret'},config.key,'org:page:1');assert.notEqual(a,b);assert.ok(!a.includes('secret'));assert.deepEqual(unseal(a,config.key,'org:page:1'),{token:'secret'});assert.throws(()=>unseal(a,config.key,'other:page:1'),/credential_unavailable/);assert.throws(()=>unseal(a.replace('v1','v2'),config.key,'org:page:1'));
});
test('OAuth requests only read scopes, fixed HTTPS callback and supported version',()=>{
 const url=new URL(oauthURL(config,'random-state'));assert.equal(url.hostname,'www.facebook.com');assert.equal(url.searchParams.get('response_type'),'code');assert.equal(url.searchParams.get('scope'),READ_SCOPES.join(','));assert.ok(!url.href.includes('test-app-secret'));assert.ok(!url.href.includes('pages_manage_posts'));assert.throws(()=>configuration({META_APP_ID:'123',META_APP_SECRET:'secret',META_TOKEN_ENCRYPTION_KEY:config.key.toString('base64'),META_REDIRECT_URI:'http://hq.test/api/meta/oauth/callback'}));
});
test('Graph requests are bounded, use bearer/proof, never follow provider pagination URLs or leak provider errors',async()=>{
 let seen;const graph=new Graph(config,async(url,init)=>{seen={url:new URL(url),init};return json({data:[{id:'1_2',message:'A',permalink_url:'https://www.facebook.com/1/posts/2',created_time:'2026-10-01T12:00:00Z'}],paging:{next:'https://attacker.test/?access_token=secret',cursors:{after:'opaque'}}});});
 const result=await graph.history('facebook','1','page-secret');assert.equal(result.after,'opaque');assert.equal(seen.url.hostname,'graph.facebook.com');assert.equal(seen.init.headers.Authorization,'Bearer page-secret');assert.equal(seen.init.redirect,'error');assert.ok(!seen.url.href.includes('page-secret'));assert.equal(result.posts[0].publishedAt,'2026-10-01T12:00:00.000Z');assert.equal(result.posts[0].url,'https://www.facebook.com/1/posts/2');
 await assert.rejects(graph.history('facebook','https://evil.test','secret'),/invalid_platform_id/);
 const bad=new Graph(config,async()=>json({error:{code:190,message:'token: top-secret'}},400));await assert.rejects(bad.permissions('secret'),e=>e.message==='meta_reconnect_required'&&!String(e).includes('top-secret'));
});
test('insights use current allowlists and preserve unavailable values rather than zeros',async()=>{
 const names=[];const graph=new Graph(config,async url=>{const metric=new URL(url).searchParams.get('metric');names.push(metric);return metric==='page_follows'?json({error:{code:100}},400):json({data:[{name:metric,period:'day',values:[{value:3,end_time:'2026-10-01T00:00:00Z'}]}]});});
 const r=await graph.insights('page','1','secret');assert.deepEqual(names,[...METRICS.page]);assert.deepEqual(r.unavailable,['page_follows']);assert.equal(r.metrics.page_follows,undefined);assert.equal(r.metrics.page_media_view.values[0].value,3);assert.ok(names.every(n=>!n.includes('impressions')));
});
test('publication cannot send any request and platform plans remain independent',async()=>{
 let calls=0;const adapter=new MetaPublicationAdapter(new Graph(config,async()=>{calls++;throw Error('must not call');}));
 const input={idempotencyKey:'key',platform:'facebook',accountId:'1',approvedRevision:2,caption:'A',scheduledAt:'2099-01-01T00:00:00Z'};
 await assert.rejects(adapter.publish(input),/live_publishing_disabled/);assert.equal(calls,0);
 assert.equal(publicationPlan(input).path,'1/feed');assert.equal(publicationPlan({...input,platform:'instagram',imageUrl:'https://media.test/image.jpg'}).next.path,'1/media_publish');assert.throws(()=>publicationPlan({...input,platform:'instagram'}),/instagram_image_required/);
});
test('uncertain writes never become retryable from a caption match or missing receipt',async()=>{
 const graph=new Graph(config,async()=>json({data:[{id:'1_2',message:'A',created_time:'2026-10-01T12:00:00Z',permalink_url:'https://facebook.com/1/posts/2'}]}));
 const r=await new MetaPublicationAdapter(graph).reconcile({platform:'facebook',accountId:'1',caption:'A',token:'secret',attemptedAt:'2026-10-01T12:00:00Z'});assert.equal(r.state,'uncertain');assert.equal(r.retryAllowed,false);assert.equal(r.candidates.length,1);
 await assert.rejects(graph.verify('facebook','9','1_2','secret'),/receipt_account_mismatch/);
 const ig=new Graph(config,async()=>json({id:'5',owner:{id:'wrong'},timestamp:'2026-10-01T00:00:00Z',permalink:'https://instagram.com/p/a'}));await assert.rejects(ig.verify('instagram','7','5','secret'),/receipt_account_mismatch/);
});
test('normalization removes unicode whitespace variations without AI; diagnostics expose missing scopes and expiration',()=>{
 assert.equal(contentHash(' Ｈello\u200b  WORLD\n'),contentHash('hello world'));const d=diagnostics([],[],new Date(0).toISOString(),null,null);assert.equal(d.expired,true);assert.ok(d.missingPermissions.includes('pages_show_list'));assert.equal(d.livePublishing,false);
});
test('sync persists sanitized output only under the supplied lease and never publishes',async()=>{
 const calls=[],lease={orgId:'org',id:'task',token:'lease',stage:'meta_sync'};
 const broker=async(actor,action,payload)=>{calls.push({actor,action,payload});if(action==='lease-context')return {connection:{page_id:'1',instagram_id:'2'},ciphertext:seal({pageToken:'page-secret',userToken:'user-secret'},config.key,'org:page:1'),payload:{phase:'scheduled'}};return {};};
 await synchronize(lease,'actor',broker,config,new Graph(config,async()=>json({data:[]})));
 assert.equal(calls[1].action,'finish-sync');assert.equal(calls[1].payload.token,'lease');assert.equal(calls[1].payload.next.phase,'instagram');assert.ok(!JSON.stringify(calls[1]).includes('page-secret'));
});

test('media fingerprinting limits destinations and bytes without forwarding tokens',async()=>{
 const {mediaFingerprint}=await import('../lib/meta/media.ts');let calls=0;
 const transport=async(url,init)=>{calls++;assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');return new Response('asset bytes');};
 const hash=await mediaFingerprint('https://scontent.cdninstagram.com/image.jpg',transport);assert.match(hash,/^[a-f0-9]{64}$/);
 for(const url of ['http://scontent.fbcdn.net/a','https://fbcdn.net.evil.test/a','https://127.0.0.1/a','https://user:pass@scontent.fbcdn.net/a'])await assert.rejects(mediaFingerprint(url,transport),/unavailable/);
 assert.equal(calls,1);await assert.rejects(mediaFingerprint('https://scontent.fbcdn.net/a',async()=>new Response('x',{headers:{'content-length':String(11*1024*1024)}})),/unavailable/);
});
test('known receipts require matching content and never authorize a retry',async()=>{
 const adapter=new MetaPublicationAdapter(new Graph(config,async()=>json({id:'1_2',message:'Expected',is_published:true,created_time:'2026-10-01T00:00:00Z',permalink_url:'https://facebook.com/1/posts/2'})));
 const input={platform:'facebook',accountId:'1',externalId:'1_2',caption:'Expected',token:'secret',attemptedAt:'2026-10-01T00:00:00Z'};
 assert.equal((await adapter.reconcile(input)).state,'verified');assert.equal((await adapter.reconcile(input)).retryAllowed,false);assert.equal((await adapter.reconcile({...input,caption:'Other'})).state,'uncertain');
});
