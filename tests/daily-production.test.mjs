import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auctionDb} from './helpers/auction-db.mjs';
import {blankDeliverable,deliverableDraft} from '../lib/hq-model.ts';
import {dailyProductionCommand,dailyTargets,dailyRows,productionScore,templateDeliverable,contentPillars,metricNames} from '../lib/daily-production.ts';

let f;before(async()=>{f=await auctionDb();});after(async()=>{await f?.db.close();});
const classification={pillar:'Northside Collects',format:'video',original:true};
const command=id=>({action:'create',id,...classification,title:'Synthetic test original',owner:'jon',approver:'steve',publisher:'brody',productionDue:'2026-10-20T00:00',publishAt:'2026-10-20T00:01',platforms:['facebook','instagram']});
async function rpc(action,payload){return (await f.db.query('select hub_daily_production($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
async function create(id,patch={}){const input={...command(id),...patch};return rpc('create',{id,...classification,pillar:input.pillar,format:input.format,original:input.original,data:templateDeliverable(input)});}
async function meta(id){return (await f.db.query('select * from hq_daily_content where deliverable_id=$1',[id])).rows[0];}
async function classify(id,patch={}){return rpc('classify',{id,version:(await meta(id))?.version||0,recordVersion:(await f.get(id)).version,...classification,...patch});}
async function story(id,platform='facebook',patch={}){return rpc('story',{id,version:(await meta(id)).version,recordVersion:(await f.get(id)).version,platform,status:'published',time:'2026-10-20T00:03',url:'',unavailableReason:'Ephemeral Story checked manually in platform',confirmed:true,...patch});}
async function publication(id,platform){let d=await f.get(id);return f.hq('publication',{id,version:d.version,platform,status:'published',confirmed:true,time:'2026-10-20T00:02',url:'https://example.test/'+id+'/'+platform,unavailableReason:''});}
async function ready(id){let d=await f.get(id);await f.hq('save-deliverable',{id,version:d.version,data:{...deliverableDraft(d),requiresFinalFile:false,caption:'Synthetic verified caption'}});d=await f.get(id);await f.hq('production',{id,version:d.version,status:'in_progress'});d=await f.get(id);await f.hq('production',{id,version:d.version,status:'needs_review'});d=await f.get(id);await f.hq('review',{id,version:d.version,decision:'approve',comment:'Synthetic approval'});}

test('quota boundaries, date validation and six exact pillars',()=>{
 assert.deepEqual(dailyTargets('2026-10-19'),{video:0,static:0,stories:{facebook:0,instagram:0}});
 for(const day of ['2026-10-20','2026-11-02'])assert.deepEqual(dailyTargets(day),{video:3,static:3,stories:{facebook:6,instagram:6}});
 assert.deepEqual(dailyTargets('2026-11-03'),{video:4,static:4,stories:{facebook:8,instagram:8}});
 assert.equal(contentPillars.length,6);assert.equal(dailyProductionCommand.safeParse(command('good')).success,true);
 for(const patch of [{pillar:'Invented pillar'},{owner:''},{publishAt:'2026-11-01T01:30'},{platforms:['facebook','facebook']},{approval:{by:'fake'}},{format:'story'}])assert.equal(dailyProductionCommand.safeParse({...command('invalid'),...patch}).success,false);
 const story={action:'story',id:'source',version:1,recordVersion:1,platform:'facebook',status:'published',time:'2026-10-20T00:03',url:'',unavailableReason:'Ephemeral Story',confirmed:true};
 assert.equal(dailyProductionCommand.safeParse(story).success,true);
 assert.equal(dailyProductionCommand.safeParse({...story,url:'invalid'}).success,false);
});

test('score counts unique originals once, groups carousel/static and separates Story receipts and incomplete cross-posts',()=>{
 const data={...blankDeliverable,publishAt:'2026-11-03T00:30:00-06:00',version:1,status:'to_do',publications:{facebook:{status:'published'},instagram:{status:'planned'}}};
 const records=[{id:'a',data},{id:'b',data},{id:'c',data},{id:'d',data},{id:'e',data:{...data,deletedAt:'now'}},{id:'f',data:{...data,workflow:'task'}}];
 const content=[{deliverable_id:'a',...classification,version:1,stories:{facebook:{status:'published'}}},{deliverable_id:'b',...classification,format:'carousel',version:1,stories:{}},{deliverable_id:'c',...classification,original:false,version:1,stories:{}}];
 const rows=dailyRows('2026-11-03',content,records),score=productionScore('2026-11-03',rows,[]);
 assert.equal(rows.length,4);assert.equal(score.video.planned,1);assert.equal(score.static.planned,1);assert.equal(score.video.published,0);assert.equal(score.stories.facebook.published,1);assert.equal(score.stories.instagram.published,0);assert.equal(score.unclassified,1);
 assert.equal(dailyRows('2026-11-02',content,records).length,0);
});

test('new draft uses canonical HQ workflow, assignment notifications and retry-safe creation without invented history',async()=>{
 await f.actor('steve');const before=(await f.db.query("select count(*)::int n from marketing_records")).rows[0].n;
 await create('new-original');const d=await f.get('new-original');assert.equal(d.status,'to_do');assert.equal(d.approval,null);assert.equal(d.requiresFinalFile,true);assert.equal(d.caption,'');assert.deepEqual(d.publications,{facebook:{status:'planned'},instagram:{status:'planned'}});
 assert.equal((await meta('new-original')).pillar,'Northside Collects');assert.equal((await create('new-original')).existing,true);
 assert.equal((await f.db.query('select count(*)::int n from marketing_records')).rows[0].n,before+1);
 assert.ok((await f.db.query("select count(*)::int n from hq_notifications where record_id='new-original'")).rows[0].n>0);
 await assert.rejects(create('new-original',{title:'Changed request'}),/request changed/);
 await assert.rejects(create('before-launch',{publishAt:'2026-10-19T12:00'}),/begin October 20/);
 await f.actor('jon');await create('other-owner',{owner:'brody'});assert.equal((await f.get('other-owner')).owner,'brody');
});

test('classification preserves canonical bytes and historical facts; stale versions, unassigned and cross-org users fail',async()=>{
 await f.actor('steve');await create('classified');const d=await f.get('classified');
 await classify('classified',{pillar:'Meet Northside'});assert.deepEqual(await f.get('classified'),d);
 await assert.rejects(rpc('classify',{id:'classified',version:1,recordVersion:d.version,...classification}),/changed/);
 await f.actor('outsider');await assert.rejects(classify('classified'),/Only assigned/);
 await f.actor('foreign');await assert.rejects(rpc('classify',{id:'classified',version:0,recordVersion:d.version,...classification}),/available/);
 assert.deepEqual((await rpc('list',{day:'2026-10-20',offset:0})).content,[]);
 await f.actor('steve');await ready('classified');await publication('classified','facebook');
 await assert.rejects(classify('classified',{original:false}),/classification is retained/);
});

test('Story receipts require source publication and publisher/approver, preserve feed history and permanently retain published facts',async()=>{
 await f.actor('steve');await create('story-source');await assert.rejects(story('story-source'),/published original/);
 await ready('story-source');await publication('story-source','facebook');const before=await f.get('story-source');
 await f.actor('jon');await assert.rejects(story('story-source'),/Only the publisher/);
 await f.actor('brody');await assert.rejects(story('story-source','facebook',{confirmed:false}),/Confirm/);
 await assert.rejects(story('story-source','instagram'),/published original/);
 await assert.rejects(story('story-source','facebook',{time:'2099-01-01T12:00'}),/past Story/);
 await assert.rejects(story('story-source','facebook',{url:'http://example.test/story',unavailableReason:''}),/HTTPS/);
 await assert.rejects(story('story-source','facebook',{time:'2026-10-20T00:01'}),/after the original/);
 await assert.rejects(story('story-source','facebook',{unavailableReason:''}),/URL|reason/);
 await story('story-source');assert.deepEqual(await f.get('story-source'),before);
 assert.equal((await meta('story-source')).stories.facebook.status,'published');
 await assert.rejects(story('story-source','facebook',{status:'planned',time:''}),/permanent/);
});

test('metric snapshots need real publication evidence, retain unknowns and observation periods, and retry without overwriting',async()=>{
 await f.actor('steve');const values=Object.fromEntries(metricNames.map(n=>[n,n==='views'?123:null]));
 const payload={id:'story-source',requestId:crypto.randomUUID(),platform:'facebook',surface:'story',observedAt:'2026-10-20T00:04',period:'lifetime',periodDate:'',evidenceUrl:'https://example.test/insights',values};
 await rpc('metrics',payload);assert.equal((await rpc('metrics',payload)).existing,true);
 await assert.rejects(rpc('metrics',{...payload,values:{...values,views:999}}),/different observation/);
 await assert.rejects(rpc('metrics',{...payload,requestId:crypto.randomUUID(),platform:'instagram'}),/Confirm publication/);
 await assert.rejects(rpc('metrics',{...payload,requestId:crypto.randomUUID(),values:{...values,views:-1}}),/nonnegative/);
 await assert.rejects(rpc('metrics',{...payload,requestId:crypto.randomUUID(),values:{...values,views:null}}),/at least one/);
 await assert.rejects(rpc('metrics',{...payload,requestId:crypto.randomUUID(),observedAt:'2026-10-19T00:00'}),/follow publication/);
 await assert.rejects(rpc('metrics',{...payload,requestId:crypto.randomUUID(),observedAt:'2099-01-01T12:00'}),/past observation/);
 const list=await rpc('list',{day:'2026-10-20',offset:0});const m=list.metrics.find(m=>m.id===payload.requestId);assert.equal(m.values.views,123);assert.equal(m.values.likes,null);assert.equal(m.period,'lifetime');assert.equal(m.period_date,null);
 await f.db.exec('reset role');const snapshot=(await f.db.query('select * from hq_daily_metrics where id=$1',[payload.requestId])).rows[0];await f.actor('jon');
 await assert.rejects(f.db.query("update hq_daily_metrics set values='{}' where id=$1",[payload.requestId]),/permission denied/);
 await assert.rejects(f.db.query('delete from hq_daily_metrics where id=$1',[payload.requestId]),/permission denied/);
 assert.deepEqual((await f.db.query('select * from hq_daily_metrics where id=$1',[payload.requestId])).rows[0],snapshot);
});

test('new tables enforce organization and agreement RLS; anonymous and direct writes are denied',async()=>{
 await f.actor('foreign');assert.deepEqual((await f.db.query('select * from hq_daily_content')).rows,[]);assert.deepEqual((await f.db.query('select * from hq_daily_metrics')).rows,[]);
 await f.actor('unsigned');await assert.rejects(rpc('list',{day:'2026-10-20',offset:0}),/agreement|sign/i);assert.deepEqual((await f.db.query('select * from hq_daily_content')).rows,[]);
 await f.actor('steve');await assert.rejects(f.db.exec("update hq_daily_content set original=false"),/permission denied/);
 await f.db.exec('reset role;set role anon');await assert.rejects(rpc('list',{day:'2026-10-20',offset:0}),/permission denied/);await assert.rejects(f.db.exec('select * from hq_daily_content'),/permission denied/);
});

test('migration adds only isolated objects; canonical records, buckets and signatures have no migration writes',async()=>{
 const sql=await readFile(new URL('../supabase/migrations/20261020050107_daily_social_production.sql',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/\b(?:update|delete from|insert into) (?:public\.)?(?:marketing_records|staff_access|agreement_acceptances|objects|buckets)\b/i);
 const vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));assert.equal(vercel.git.deploymentEnabled,false);
});

test('exact migration preserves every existing record, approval, calendar, asset, signature and audit row',async()=>{
 const baseline=await auctionDb({migrationFilter:file=>!file.endsWith('_daily_social_production.sql')});
 try{
  await baseline.hq('save-deliverable',{id:'preserved-published',version:0,data:{...blankDeliverable,title:'Synthetic historical publication',owner:'jon',approver:'steve',publisher:'steve',instructions:'Preserve this real workflow fixture.',productionDue:'2026-09-20T09:00',publishAt:'2026-09-20T12:00',format:'Image',requiresFinalFile:false,caption:'Synthetic historical caption'}});
  for(const status of ['in_progress','needs_review'])await baseline.hq('production',{id:'preserved-published',version:(await baseline.get('preserved-published')).version,status});
  await baseline.hq('review',{id:'preserved-published',version:(await baseline.get('preserved-published')).version,decision:'approve',comment:'Historical synthetic approval'});
  await baseline.hq('publication',{id:'preserved-published',version:(await baseline.get('preserved-published')).version,platform:'facebook',status:'published',confirmed:true,time:'2026-09-20T12:00',url:'https://example.test/preserved-publication',unavailableReason:''});
  assert.ok((await baseline.get('preserved-published')).approval);
  await baseline.db.exec('reset role');
  await baseline.db.query("insert into marketing_records(workspace_id,kind,id,data) values('northside-marketing','post','preserved-calendar',$1::jsonb)",[JSON.stringify({title:'Synthetic retained Tuesday series',recurrence:'weekly-tuesday',date:'2026-09-22T11:00',status:'draft',caption:'Retain the original calendar series.'})]);
  const tables=['marketing_records','hq_activity','hq_comments','hq_spend','hq_notifications','storage.objects','storage.buckets','private.staff_access','private.agreement_documents','private.agreement_acceptances','private.agreement_assignments'];
  async function snapshot(){return Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await baseline.db.query('select * from '+t+' order by 1,2')).rows])));}
  const before=await snapshot();const migration=await readFile(new URL('../supabase/migrations/20261020050107_daily_social_production.sql',import.meta.url),'utf8');await baseline.db.exec(migration);assert.deepEqual(await snapshot(),before);
  assert.equal((await baseline.db.query('select count(*)::int n from hq_daily_content')).rows[0].n,0);assert.equal((await baseline.db.query('select count(*)::int n from hq_daily_metrics')).rows[0].n,0);
  const grants=(await baseline.db.query("select has_table_privilege('authenticated','hq_daily_content','UPDATE') writable,has_function_privilege('anon','hub_daily_production(text,jsonb)','EXECUTE') public_rpc")).rows[0];assert.deepEqual(grants,{writable:false,public_rpc:false});
 }finally{await baseline.db.close();}
});

test('Chicago day selection handles offsets and both DST transitions; rescheduling retains classification without changing old facts',async()=>{
 await f.actor('steve');await create('dst-source',{publishAt:'2026-11-03T00:30'});let d=await f.get('dst-source');
 await f.db.exec("reset role;update marketing_records set data=jsonb_set(data,'{publishAt}','\"2026-11-03T06:30:00Z\"') where id='dst-source'");await f.actor('steve');
 assert.ok((await rpc('list',{day:'2026-11-03',offset:0})).content.some(c=>c.deliverable_id==='dst-source'));assert.ok(!(await rpc('list',{day:'2026-11-02',offset:0})).content.some(c=>c.deliverable_id==='dst-source'));
 d=await f.get('dst-source');await f.hq('save-deliverable',{id:'dst-source',version:d.version,data:{...deliverableDraft(d),publishAt:'2026-11-04T00:30'}});
 assert.ok((await rpc('list',{day:'2026-11-04',offset:0})).content.some(c=>c.deliverable_id==='dst-source'));assert.ok(!(await rpc('list',{day:'2026-11-03',offset:0})).content.some(c=>c.deliverable_id==='dst-source'));
 await assert.rejects(create('dst-fold',{publishAt:'2026-11-01T01:30'}),/unambiguous/);await assert.rejects(create('dst-gap',{publishAt:'2027-03-14T02:30'}),/unambiguous/);
});
