import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dailyBriefing,postingWindow,contentCategory} from '../lib/content-intelligence/briefing.ts';
import {latestPosts,totals,compare,cohort,previousRange,recommendations,spendResults,normalizeLegacyMetrics,groupPerformance} from '../lib/content-intelligence/analytics.ts';
import {readPages} from '../lib/content-intelligence/repository.ts';
import {freshness,commandInput,rangeInput} from '../lib/content-intelligence/model.ts';
import {sourceSettings} from '../lib/content-radar/model.ts';
import {collectSource} from '../lib/content-radar/collect.ts';
import {fetchUrl} from '../lib/content-radar/urls.ts';
import {SOURCE_SEEDS} from '../lib/content-radar/seeds.ts';
import {Graph} from '../lib/meta/graph.ts';
import {seal} from '../lib/meta/core.ts';
import {syncBatch,readPostMetrics} from '../lib/content-intelligence/sync.ts';

const now=new Date('2026-10-16T15:00:00Z');
const item=(id,extra={})=>({id,title:'Source headline '+id,url:'https://ripped.topps.com/'+id,category:'Baseball',kind:'story',priority:'normal',status:'new',verification:'unverified',published_at:'2026-10-15',event_date:null,summary:'Publisher summary',collected_at:now.toISOString(),...extra});
const post=(id,extra={})=>({page_id:'1',platform:'facebook',external_id:id,caption:'Fixture',url:'https://facebook.com/1/posts/'+id,published_at:'2026-10-16T17:00:00Z',state:'published',media_type:'PHOTO',...extra});
const snapshot=(id,metrics,extra={})=>({id:'s'+id,page_id:'1',platform:'facebook',subject_id:id,kind:'post',observed_at:now.toISOString(),metrics,unavailable:[],...extra});
test('briefing yields at most five sourced, reviewable ideas using existing templates and calendar gaps',()=>{
 const result=dailyBriefing(Array.from({length:9},(_,n)=>item(String(n))),{},[],[{date:'2026-10-16T11:00'}],now);
 assert.equal(result.ideas.length,5);assert.equal(new Set(result.ideas.map(i=>i.window.start)).size,5);
 for(const i of result.ideas){assert.equal(i.publishedAt,'2026-10-15');assert.ok(i.sourceUrl.startsWith('https://ripped.topps.com/'));assert.equal(i.verification,'unverified');assert.equal(i.confidence,'medium');assert.equal(i.window.timezone,'America/Chicago');assert.notEqual(i.window.start,'2026-10-16T11:00');assert.ok(i.facebook.includes(i.sourceUrl));assert.equal(i.originalImagesRequired,true);assert.ok(!/in stock|sold for|guaranteed/.test(i.facebook));}
});
test('missing, future, old and disputed evidence never becomes filler news',()=>{
 const r=dailyBriefing([item('a',{published_at:null}),item('b',{published_at:'2027-01-01'}),item('c',{published_at:'2025-01-01'}),item('d',{verification:'disputed'}),item('e'),item('e')],{},[],[],now);
 assert.equal(r.ideas.length,1);assert.ok(r.notes[0].includes('Only 1'));
 const timed=dailyBriefing([item('today',{published_at:'2026-10-16T14:00:00Z'}),item('invalid',{published_at:'invalid'}),item('later',{published_at:'2026-10-16T16:00:00Z'})],{},[],[],now);
 assert.deepEqual(timed.ideas.map(i=>i.itemId),['today']);
});
test('all requested editorial categories have explicit paths',()=>{
 for(const [title,category] of [['Auction closing','Auctions'],['Consignment guide','Consignment'],['Pokemon news','Pokemon'],['Marvel checklist','Entertainment cards'],['Store promotion','Store promotions']])assert.equal(contentCategory(item('a',{title})),category);
 assert.equal(contentCategory(item('a',{kind:'release'})),'New releases');assert.equal(contentCategory(item('a',{kind:'chase'})),'Chase cards');assert.equal(contentCategory(item('a')),'Sports');
});
test('posting windows honor Chicago offsets, recurring Tuesday slots, and daily calendar capacity',()=>{
 const time=new Date('2026-11-03T15:00:00Z');
 const window=postingWindow(time,[{date:'2026-09-01T11:00',recurrence:'weekly-tuesday'},{date:'2026-11-03T20:00:00Z'},{date:'2026-11-03T18:00'}]);
 assert.equal(window.start,'2026-11-04T11:00');
 assert.equal(commandInput.safeParse({action:'handoff',reportId:crypto.randomUUID(),ideaId:'a',calendar:true,date:'2026-11-01T01:30'}).success,false);
});
test('source cadence, page permission and licensed domain restrictions are enforced',()=>{
 assert.equal(freshness('2026-10-16T14:30:00Z',60,now),'Fresh');assert.equal(freshness(null,60,now),'Never checked');assert.equal(freshness('2026-10-14',60,now),'Due');
 const input={name:'Source',url:'https://ripped.topps.com/',category:'Baseball',priority:'high',enabled:true,mode:'discover',cadenceMinutes:60,allowPage:true,permissionNote:''};
 assert.equal(sourceSettings.safeParse(input).success,false);assert.equal(sourceSettings.safeParse({...input,permissionNote:'Publisher written permission'}).success,true);
 for(const url of ['https://www.cardladder.com/private','https://instagram.com/a','https://127.0.0.1','https://www.dacardworld.com.evil.test'])assert.throws(()=>fetchUrl(url,url));
 assert.ok(SOURCE_SEEDS.find(s=>s.key==='card-ladder-licensed').social);
 for(const key of ['topps-ripped','topps-calendar','fanatics-news','fanatics-collect-news','dave-adams-news','steel-city'])assert.ok(SOURCE_SEEDS.find(s=>s.key===key));
});
test('supported feed wins; page fallback requires permission and robots allowance',async()=>{
 const source={url:'https://www.dacardworld.com/blog/',method:'discover',feed_url:null,allow_page:false};
 const doc=(body,url=source.url)=>({url,body,status:200,etag:null,modified:null});
 const reader=async url=>url.endsWith('/robots.txt')?doc('User-agent: *\nAllow: /',url):doc('<html><head><meta property="og:title" content="Example news"><meta property="og:description" content="Evidence"></head></html>',url);
 await assert.rejects(collectSource(source,reader),/permission/i);
 await assert.rejects(collectSource({...source,allow_page:true},async url=>doc('User-agent: *\nDisallow: /',url)),/prohibit/);
 const feed=await collectSource({...source,feed_url:'https://www.dacardworld.com/blog/feed/'},async url=>doc('<rss version="2.0"><channel><item><title>A</title><link>https://www.dacardworld.com/blog/a</link></item></channel></rss>',url));assert.equal(feed.method,'rss');
});
test('snapshots use latest observation once; account metrics and other channels never contaminate posts',()=>{
 const rows=latestPosts([post('2')],[snapshot('2',{views:10,likes:3}),snapshot('2',{views:20,likes:4},{id:'later',observed_at:'2026-10-16T16:00:00Z'}),snapshot('2',{views:9000},{kind:'account'}),snapshot('2',{views:999},{platform:'instagram'})],[],new Date('2026-10-17'));
 assert.equal(totals(rows).views.value,20);assert.equal(totals(rows).likes.value,4);assert.equal(totals(rows).impressions.value,null);assert.equal(totals(rows).reactions.value,null);
 assert.equal(latestPosts([post('2')],[snapshot('2',{views:10})],[],new Date('2026-10-15'))[0].snapshot,null);
});
test('zero is real; missing values do not become zero or percentage drops',()=>{
 const t=totals(latestPosts([post('2'),post('3')],[snapshot('2',{views:0,reach:12})],[],now));assert.equal(t.views.value,0);assert.equal(t.views.covered,1);assert.equal(t.reach.value,12);assert.equal(compare(t.views,{value:10,covered:2,posts:2}),null);
 assert.equal(compare({value:2,covered:1,posts:1},{value:0,covered:1,posts:1}).percent,null);
});
test('date cohorts use Chicago days and previous ranges match length',()=>{
 assert.deepEqual(previousRange('2026-10-10','2026-10-16'),{from:'2026-10-03',to:'2026-10-09'});
 const rows=latestPosts([post('1',{published_at:'2026-10-17T03:00:00Z'})],[],[],now);assert.equal(cohort(rows,'2026-10-16','2026-10-16').length,1);
 assert.equal(rangeInput.safeParse({from:'2026-02-30',to:'2026-03-10'}).success,false);
});
test('recommendations demand within-channel samples and expose supporting metric counts',()=>{
 const p=Array.from({length:6},(_,i)=>post(String(i),{media_type:i<3?'VIDEO':'PHOTO'})),s=p.map((p,i)=>snapshot(p.external_id,{shares:i<3?12:2}));
 assert.equal(recommendations(latestPosts(p.slice(0,5),s,[],now)).length,0);
 const r=recommendations(latestPosts(p,s,[],now));assert.equal(r[0].value,'VIDEO');assert.equal(r[0].sample,3);assert.equal(r[0].baselineSample,3);assert.equal(r[0].average,12);assert.equal(r[0].metric,'shares');
});
test('spend uses exact campaign evidence and never infers sales ROI',()=>{
 const rows=[{id:'1',data:{date:'2026-10-16',source:'facebook',campaign:'auction-245',spend:20,clicks:10}},{id:'2',data:{date:'2026-10-16',source:'facebook',campaign:'auction-246',spend:1000,clicks:1}}];
 const r=spendResults(rows,'2026-10-16','2026-10-16','facebook','auction-245');assert.equal(r.spend.value,20);assert.equal(r.costPerClick,2);assert.equal(r.confirmedSalesROI,null);
 assert.equal(spendResults(rows,'2026-10-16','2026-10-16','instagram').spend.value,null);
});
test('historical paid/organic and impressions remain distinct from current views',()=>{
 assert.deepEqual(normalizeLegacyMetrics({post_media_view:{values:[{value:50}]},post_impressions:{values:[{value:30}]},post_impressions_paid:{values:[{value:10}]},post_impressions_organic:{values:[{value:20}]}}),{views:50,impressions:30,paidImpressions:10,organicImpressions:20});
});
const config={appId:'123',appSecret:'fixture',version:'v26.0',redirectUri:'https://hq.test/api/meta/oauth/callback',key:Buffer.alloc(32,7)};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
test('read-only sync uses persistent cursors and fixed Graph host, with overlapping incremental window',async()=>{
 const calls=[],requests=[];const broker=async(action,payload)=>{calls.push({action,payload});return action==='claim'?{org:'org',account:'1',token:'lease',after:'cursor',watermark:'2026-10-15T12:00:00Z',until:'2026-10-16T12:00:00Z',ciphertext:seal({pageToken:'fixture-token'},config.key,'org:page:1')}:{ok:true};};
 await syncBatch({pageId:'1',platform:'facebook',mode:'current'},broker,config,new Graph(config,async(url,init)=>{requests.push({url:new URL(url),init});return json({data:[],paging:{cursors:{after:'next-cursor'},next:'https://attacker.test/token'}});}));
 assert.equal(requests[0].url.hostname,'graph.facebook.com');assert.equal(requests[0].url.searchParams.get('after'),'cursor');assert.equal(requests[0].url.searchParams.get('since'),String(Date.parse('2026-10-13T12:00:00Z')/1000));assert.equal(requests[0].init.method,undefined);assert.equal(calls[1].payload.after,'next-cursor');assert.ok(!JSON.stringify(calls[1]).includes('fixture-token'));
});
test('rate-limit errors are sanitized and do not advance cursor or commit partial snapshots',async()=>{
 const payloads=[],broker=async(action,p)=>{if(action==='claim')return {org:'org',account:'1',token:'lease',after:null,until:now.toISOString(),ciphertext:seal({pageToken:'fixture-token'},config.key,'org:page:1')};payloads.push(p);};
 await syncBatch({pageId:'1',platform:'facebook',mode:'history'},broker,config,new Graph(config,async()=>json({error:{code:4,message:'private-provider-text'}},429)));
 assert.equal(payloads[0].error,'meta_rate_limited');assert.equal(payloads[0].after,undefined);assert.ok(!JSON.stringify(payloads).includes('private-provider-text'));
});
test('individual unavailable insight metrics preserve zero and do not alias views to reach',async()=>{
 const graph=new Graph(config,async url=>{const metric=new URL(url).searchParams.get('metric');return metric==='reach'?json({error:{code:100}},400):json({data:[{name:metric,values:[{value:0}]}]});});
 const r=await readPostMetrics(graph,'instagram','2','fixture');assert.equal(r.metrics.views,0);assert.equal(r.metrics.reach,null);assert.equal(r.metrics.impressions,null);assert.equal(r.metrics.saves,0);assert.ok(r.unavailable.includes('reach'));
});
test('campaign kinds stay distinct when a project and campaign share an ID',()=>{
 const posts=latestPosts([post('1'),post('2')],[],[{page_id:'1',platform:'facebook',external_id:'1',campaign_id:'weekly',campaign_kind:'project'},{page_id:'1',platform:'facebook',external_id:'2',campaign_id:'weekly',campaign_kind:'campaign'}],now);
 assert.equal(cohort(posts,'2026-10-16','2026-10-16',{campaign:'project:weekly'}).length,1);
 assert.deepEqual(groupPerformance(posts,'campaign').map(g=>g.name),['project:weekly','campaign:weekly']);
});
test('daily insight periods and empty reaction objects never become lifetime totals or zero',async()=>{
 const graph=new Graph(config,async url=>{const metric=new URL(url).searchParams.get('metric');return json({data:[{name:metric,period:metric==='post_media_view'?'day':'lifetime',values:[{value:metric==='post_reactions_by_type_total'?{}:10}]}]});});
 const r=await readPostMetrics(graph,'facebook','1_2','fixture');assert.equal(r.metrics.views,null);assert.equal(r.metrics.reactions,null);
 assert.deepEqual(normalizeLegacyMetrics({views:{period:'day',values:[{value:100}]}}),{views:null});
});
test('storage pagination advances stable cursors, marks bounds, and rejects repeated cursors',async()=>{
 const batch=Array.from({length:500},(_,n)=>({id:String(n).padStart(4,'0')})),calls=[];
 const result=await readPages(async after=>{calls.push(after);return {data:after?[{id:'0500'}]:batch,error:null};},r=>r.id);
 assert.equal(result.rows.length,501);assert.equal(result.truncated,false);assert.deepEqual(calls,[null,'0499']);
 assert.equal((await readPages(async()=>({data:batch,error:null}),r=>r.id,1)).truncated,true);
 await assert.rejects(readPages(async()=>({data:batch,error:null}),r=>r.id),/cursor/);
});
