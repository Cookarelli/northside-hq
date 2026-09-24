import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {auctionDb} from './helpers/auction-db.mjs';
import {deliverableDraft} from '../lib/hq-model.ts';
import {auctionStatus} from '../lib/auction-deliverables.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
import {campaignFinancials,compactUsd,compactVariance,auctionFinanceCommand} from '../lib/auction-finance.ts';
let f,migration;
before(async()=>{f=await auctionDb({numbered:true});const dir=new URL('../supabase/migrations/',import.meta.url);migration=await readFile(new URL((await readdir(dir)).find(n=>n.endsWith('_auction_spending_reconciliation.sql')),dir),'utf8');});
after(async()=>await f?.db.close());
const rpc=async(fn,p)=>(await f.db.query('select '+fn+'($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;
const finance=async(action,p)=>(await f.db.query('select hub_auction_finance($1,$2::jsonb) result',[action,JSON.stringify(p)])).rows[0].result;
const children=async()=> (await f.db.query("select id,data from marketing_records where kind='deliverable' and data->>'auctionCampaignId'='usability-246' order by id")).rows;
const campaign=()=>f.get('usability-246','auction_campaign');
const spend=async(id,amountCents,channel='Meta',extra={})=>finance('spend',{id:crypto.randomUUID(),deliverableId:id,version:(await f.get(id)).version,channel,amountCents,spentOn:'2026-09-20',note:'Invoice checked',...extra});
const reconcilePayload=async()=>({id:'usability-246',version:(await campaign()).version,deliverableVersions:Object.fromEntries((await children()).map(r=>[r.id,r.data.version]))});
const snapshot=async()=>({records:(await f.db.query('select * from marketing_records order by kind,id')).rows,spend:(await f.db.query('select * from hq_spend order by id')).rows,activity:(await f.db.query('select * from hq_activity order by id')).rows,notifications:(await f.db.query('select * from hq_notifications order by id')).rows});
async function publish(id){let d=await f.get(id);await f.actor('steve');d=(await f.hq('save-deliverable',{id,version:d.version,data:{...deliverableDraft(d),caption:'Final campaign copy',references:['https://example.test/final.mp4'],linkRoles:{'https://example.test/final.mp4':'final'}}})).data;await f.actor('brody');for(const status of ['in_progress','needs_review'])d=(await f.hq('production',{id,version:d.version,status})).data;d=(await f.hq('review',{id,version:d.version,decision:'approve',comment:''})).data;for(const platform of d.platforms)d=(await f.hq('publication',{id,version:d.version,platform,status:'published',time:'2026-09-20T19:00',confirmed:true,url:'https://example.test/'+id+'/'+platform,unavailableReason:''})).data;assert.equal(auctionStatus(d,await f.get('weekly','project')),'published');}

test('create → assign → allocate → channel spend uses exact totals and calendar-derived reminders',async()=>{
 await f.actor('brody');assert.equal(campaignFinancials(undefined,[{id:'unknown',data:await f.get('mj-24')}]).budget,null);await rpc('hub_create_auction_campaign',{id:'usability-246',projectId:'weekly',data:{auction_number:246,name:'Next Auction',closesAt:'2026-10-04T21:00',owner:'jon',assignees:['outsider'],featuredCard:'Featured card',auctionPlatform:'Collect',auctionUrl:'https://example.test/auction',lotUrls:[],assetLinks:[],internalNotes:'Weekly test',campaignBudgetCents:45000},plannedBudgets:{'48':17500,'24':15000,'2':12500}});
 let rows=await children();assert.equal(rows.length,3);assert.equal(campaignFinancials(await campaign(),rows).state,'Open');assert.equal(campaignFinancials(await campaign(),rows).variance,null);
 const id='usability-246-48h';const request={id:crypto.randomUUID(),deliverableId:id,version:(await f.get(id)).version,channel:'Meta',amountCents:10000,spentOn:'2026-09-20',note:'First invoice'};
 await finance('spend',request);const saved=await snapshot();await finance('spend',request);assert.deepEqual(await snapshot(),saved,'A retry adds neither spending nor history');
 await spend(id,6000,'Creative production');assert.equal((await f.get(id)).actualSpendCents,16000);assert.equal((await f.get(id)).spendLedger,true);
 await spend('usability-246-24h',14000,'Facebook');await spend('usability-246-2h',12000,'Instagram');rows=await children();const totals=campaignFinancials(await campaign(),rows);assert.equal(totals.actual,42000n);assert.equal(totals.variance,3000n);assert.equal(compactVariance(totals.variance),'$30 under');assert.equal(compactUsd(14237),'$142.37');assert.equal(compactUsd(17500),'$175');
 assert.equal((await finance('list',{deliverableId:id})).entries.length,2);
 const project={id:'weekly',data:await f.get('weekly','project')};const events=calendarEntries(rows,[project],[],[],'2026-10-01','2026-10-05').filter(e=>e.key.endsWith(':reminder'));assert.equal(events.length,3);assert.ok(events.every(e=>e.title.startsWith('#246 Next Auction — ')),'Keep Auction when it is part of the campaign name');
 const ledger=(await f.db.query("select sum(amount_cents)::text amount from hq_spend where project_id='weekly'")).rows[0];assert.equal(ledger.amount,'42000');
 await assert.rejects(finance('reconcile',await reconcilePayload()),/Publish all three/);
});
test('publication → Ready → Reconcile; snapshots and idempotent retries preserve all work and spend',async()=>{
 for(const {id} of await children())await publish(id);let rows=await children();assert.equal(campaignFinancials(await campaign(),rows).state,'Ready');
 const payload=await reconcilePayload();await finance('reconcile',payload);let c=await campaign();assert.equal(c.reconciliation.by,'brody');assert.equal(c.reconciliation.actualCents,42000);assert.equal(c.reconciliation.varianceCents,3000);assert.equal(campaignFinancials(c,rows).state,'Reconciled');
 const saved=await snapshot();await finance('reconcile',payload);assert.deepEqual(await snapshot(),saved);
 await f.actor('outsider');assert.equal((await finance('list',{deliverableId:'usability-246-48h'})).entries.length,2,'Campaign staff can still inspect reconciled spending');
});
test('spend corrections synchronize totals, reopen reconciliation and cannot be overwritten by an aggregate edit',async()=>{
 await f.actor('outsider');const id='usability-246-48h',entries=(await finance('list',{deliverableId:id})).entries;const original=entries.find(e=>e.channel==='Meta');
 const request={id:crypto.randomUUID(),deliverableId:id,version:(await f.get(id)).version,reverses:original.id,note:'Duplicate invoice'};await finance('reverse',request);assert.equal((await f.get(id)).actualSpendCents,6000);assert.equal((await campaign()).reconciliation,null);assert.equal(campaignFinancials(await campaign(),await children()).state,'Ready');
 const saved=await snapshot();await finance('reverse',request);assert.deepEqual(await snapshot(),saved);await assert.rejects(finance('reverse',{...request,id:crypto.randomUUID(),version:(await f.get(id)).version}),/already corrected/);
 await assert.rejects(rpc('hub_deliverable_budget',{id,version:(await f.get(id)).version,data:{plannedBudgetCents:17500,actualSpendCents:1}}),/calculated from its channel entries/);assert.equal((await f.get(id)).actualSpendCents,6000);
 await f.actor('brody');await finance('reconcile',await reconcilePayload());const d=await f.get(id);await rpc('hub_deliverable_budget',{id,version:d.version,data:{plannedBudgetCents:18000,actualSpendCents:6000}});assert.equal((await campaign()).reconciliation,null);
 await finance('reconcile',await reconcilePayload());const c=await campaign();await rpc('hub_auction_campaign',{id:'usability-246',version:c.version,data:{name:c.name,auction_number:c.auction_number,closesAt:'2026-10-04T21:00',campaignBudgetCents:50000}});assert.equal((await campaign()).reconciliation,null);
});
test('legacy project correction path updates the same reminder and handles an identical retry',async()=>{
 await f.actor('joey');const id='usability-246-24h',e=(await finance('list',{deliverableId:id})).entries.find(e=>!e.reverses&&!e.reversed),p={id:crypto.randomUUID(),projectId:'weekly',reverses:e.id,note:'Correct at project level'};
 const ops=async()=>f.db.query("select hub_hq_operations('spend-reverse',$1::jsonb)",[JSON.stringify(p)]);await ops();assert.equal((await f.get(id)).actualSpendCents,0);const saved=await snapshot();await ops();assert.deepEqual(await snapshot(),saved);
});
test('authorization, stale reconciliation, invalid amounts and rollback are enforced by the database',async()=>{
 await f.actor('brody');const stale=await reconcilePayload();await spend('usability-246-2h',37);await assert.rejects(finance('reconcile',stale),/reminder changed/);
 for(const who of ['foreign','unsigned']){await f.actor(who);await assert.rejects(spend('usability-246-2h',100));await assert.rejects(finance('reconcile',stale));}
 await f.actor('outsider');await assert.rejects(finance('reconcile',await reconcilePayload()),/Only project members/);
 await assert.rejects(spend('mj-48',100),/Only involved staff/);
 await f.actor('steve');const saved=await snapshot();for(const amount of [-1,0,1.2,1000000000000])await assert.rejects(spend('usability-246-48h',amount));assert.deepEqual(await snapshot(),saved);
 const d=await f.get('usability-246-48h');await assert.rejects(spend('usability-246-48h',999999999999),/total must be/);assert.deepEqual(await f.get('usability-246-48h'),d);
 assert.equal(auctionFinanceCommand.safeParse({action:'auction-spend',id:crypto.randomUUID(),deliverableId:'x',version:1,channel:'Meta',amountCents:1.5,spentOn:'2026-09-20',note:''}).success,false);
 await f.db.exec('reset role;set role anon');await assert.rejects(finance('list',{deliverableId:'mj-48'}),/permission denied/);
});
test('previous manual actuals are preserved once; blank spend never becomes zero implicitly; replay preserves history',async()=>{
 await f.actor('steve');let d=await f.get('mj-48');await rpc('hub_deliverable_budget',{id:'mj-48',version:d.version,data:{plannedBudgetCents:15000,actualSpendCents:14237}});await spend('mj-48',100);d=await f.get('mj-48');assert.equal(d.actualSpendCents,14337);assert.equal((await finance('list',{deliverableId:'mj-48'})).entries.filter(e=>e.channel==='Previously recorded').length,1);
 assert.equal((await f.get('mj-24')).actualSpendCents,undefined);await rpc('hub_deliverable_budget',{id:'mj-24',version:(await f.get('mj-24')).version,data:{plannedBudgetCents:null,actualSpendCents:0}});assert.equal((await f.get('mj-24')).actualSpendCents,0);
 await f.db.exec('reset role');await f.db.query("select set_config('request.jwt.claim.sub','',false)");const saved=await snapshot();await f.db.exec(migration);assert.deepEqual(await snapshot(),saved);
});
