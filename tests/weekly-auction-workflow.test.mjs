import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {auctionDb} from './helpers/auction-db.mjs';
import {blankProject,blankDeliverable,deliverableDraft,canWork} from '../lib/hq-model.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
import {auctionStatus,campaignGroups} from '../lib/auction-deliverables.ts';
import {createAuctionCampaignCommand,nextAuctionNumber,isWeeklyAuctionHome,allocationLabel} from '../lib/auction-campaigns.ts';
import {budgetTotals} from '../lib/deliverable-budget.ts';
let f,migration,original;
const payload=(id,number=246)=>({id,projectId:'weekly',data:{name:'Featured Jordan card',auction_number:number,closesAt:'2026-10-04T21:15',featuredCard:'Jordan card description',auctionPlatform:'Fanatics Collect',auctionUrl:'https://example.test/auction',lotUrls:['https://example.test/lot-a','https://example.test/lot-b'],owner:'jon',assignees:['outsider'],assetLinks:['https://example.test/card.jpg'],internalNotes:'Check lot details before publishing.',campaignBudgetCents:45000},plannedBudgets:{'48':17500,'24':15000,'2':12500}});
before(async()=>{f=await auctionDb({numbered:true});const dir=new URL('../supabase/migrations/',import.meta.url);migration=await readFile(new URL((await readdir(dir)).find(n=>n.endsWith('_reusable_weekly_auctions.sql')),dir),'utf8');});
after(async()=>await f?.db.close());
const rpc=async(fn,payload)=>(await f.db.query('select '+fn+'($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
const create=p=>rpc('hub_create_auction_campaign',p);
const all=async(kind)=>(await f.db.query('select id,data from marketing_records where kind=$1 order by id',[kind])).rows;
const children=async(id)=>(await all('deliverable')).filter(r=>r.data.auctionCampaignId===id);
const project=async()=>({id:'weekly',data:await f.get('weekly','project')});
const campaign=async(id,data)=>rpc('hub_auction_campaign',{id,version:(await f.get(id,'auction_campaign')).version,data});
async function snapshot(){return {records:(await f.db.query('select * from marketing_records order by workspace_id,kind,id')).rows,activity:(await f.db.query('select * from hq_activity order by id')).rows,notifications:(await f.db.query('select * from hq_notifications order by id')).rows};}

test('existing #245 remains under the permanent parent, with no additional project or work item',async()=>{
 await f.actor('steve');assert.equal((await all('project')).length,1);assert.equal((await all('deliverable')).length,3);
 const campaigns=await all('auction_campaign');assert.equal(campaigns.length,1);assert.equal(campaigns[0].data.auction_number,245);assert.equal(campaigns[0].data.owner,'jon');assert.equal(nextAuctionNumber(campaigns),246);assert.ok(isWeeklyAuctionHome(await project(),campaigns));
});
test('project staff create a numbered campaign and exactly three inherited, independently budgeted reminders atomically',async()=>{
 await f.actor('brody');original=payload('weekly-246');const before=await project();const result=await create(original);assert.equal(result.existing,false);
 assert.deepEqual(await project(),before);const work=await children('weekly-246');assert.equal(work.length,3);
 for(const {id,data:d} of work){const hours=d.reminderHours;assert.equal(d.title,`#246 Featured Jordan card — ${hours} Hour Reminder`);assert.equal(d.productionDue,{'48':'2026-10-02T21:15','24':'2026-10-03T21:15','2':'2026-10-04T19:15'}[hours]);assert.equal(d.publishAt,d.productionDue);assert.equal(d.owner,'jon');assert.deepEqual(d.contributors,['outsider']);assert.equal(d.status,'to_do');assert.equal(d.projectId,'weekly');assert.equal(d.campaignFeaturedCard,original.data.featuredCard);assert.equal(d.campaignAuctionPlatform,'Fanatics Collect');assert.equal(d.campaignAuctionUrl,original.data.auctionUrl);assert.deepEqual(d.campaignLotUrls,original.data.lotUrls);assert.deepEqual(d.campaignAssetLinks,original.data.assetLinks);assert.equal(d.destinationUrl,original.data.lotUrls[0]);assert.equal(d.references.length,3);assert.equal(d.notes,original.data.internalNotes);assert.equal(d.plannedBudgetCents,original.plannedBudgets[hours]);assert.equal(d.actualSpendCents,null);assert.equal(id,`weekly-246-${hours}h`);}
 assert.equal(budgetTotals(work).planned,BigInt(45000));assert.equal(nextAuctionNumber(await all('auction_campaign')),247);assert.equal(campaignGroups(await all('deliverable'))[0].key,'weekly-246');
 const events=calendarEntries(await all('deliverable'),[await project()],[],[],'2026-10-01','2026-10-05').filter(e=>e.key.endsWith(':reminder'));assert.equal(events.length,3);assert.ok(events.every(e=>e.title.startsWith('#246 Featured Jordan card — ')&&!e.title.includes('#246 #246')));assert.equal((await all('post')).length,0);assert.equal((await all('project')).length,1);
});
test('creation retries preserve later edits; duplicate numbers and reminder identities are protected in the database',async()=>{
 await f.actor('steve');let d=await f.get('weekly-246-48h');await f.hq('save-deliverable',{id:'weekly-246-48h',version:d.version,data:{...deliverableDraft(d),title:'Custom reminder title',productionDue:'2026-10-02T20:00'}});
 const before=await snapshot();assert.equal((await create(original)).existing,true);assert.deepEqual(await snapshot(),before);
 await assert.rejects(create({...original,data:{...original.data,name:'Changed retry'}}),/already used/);assert.deepEqual(await snapshot(),before);
 await assert.rejects(create(payload('duplicate-246',246)),/already exists.*247/);assert.deepEqual(await snapshot(),before);
 await f.db.exec('reset role');await assert.rejects(f.db.query("insert into marketing_records select workspace_id,kind,'duplicate-number',data,updated_at from marketing_records where kind='auction_campaign' and id='weekly-246'"),/hq_auction_number_unique/);
 await assert.rejects(f.db.query("insert into marketing_records select workspace_id,kind,'duplicate-reminder',data,updated_at from marketing_records where kind='deliverable' and id='weekly-246-48h'"),/hq_auction_reminder_unique/);
});
test('campaign-only assignees can act after individual reassignment, while unrelated staff and revoked members are denied',async()=>{
 await f.actor('steve');for(const id of ['weekly-246-48h','weekly-246-24h']){let d=await f.get(id);await f.hq('save-deliverable',{id,version:d.version,data:{...deliverableDraft(d),owner:'brody',contributors:[],publisher:'brody',caption:'Final reminder copy',linkRoles:{'https://example.test/card.jpg':'final'}}});}
 await f.actor('outsider');let d=await f.get('weekly-246-48h');assert.ok(canWork(d,(await project()).data,await f.hq('context')));
 for(const status of ['in_progress','needs_review'])d=(await f.hq('production',{id:'weekly-246-48h',version:d.version,status})).data;
 d=(await f.hq('review',{id:'weekly-246-48h',version:d.version,decision:'approve',comment:''})).data;
 for(const platform of ['facebook','instagram'])d=(await f.hq('publication',{id:'weekly-246-48h',version:d.version,platform,status:'scheduled',confirmed:true,time:d.publishAt,url:'',unavailableReason:''})).data;
 assert.equal(auctionStatus(d,(await project()).data),'scheduled');
 for(const platform of ['facebook','instagram'])d=(await f.hq('publication',{id:'weekly-246-48h',version:d.version,platform,status:'published',confirmed:true,time:'2026-09-20T19:00',url:'https://example.test/'+platform,unavailableReason:''})).data;
 assert.equal(auctionStatus(d,(await project()).data),'published');assert.equal(d.actualSpendCents,null);
 const untouched=await f.get('weekly-246-24h');await f.actor('steve');await campaign('weekly-246',{...original.data,assignees:[]});
 const after=await f.get('weekly-246-24h');for(const key of ['owner','contributors','productionDue','notes','plannedBudgetCents','actualSpendCents','status'])assert.deepEqual(after[key],untouched[key]);
 await f.actor('outsider');assert.equal(canWork(after,(await project()).data,await f.hq('context')),false);await assert.rejects(f.hq('production',{id:'weekly-246-24h',version:after.version,status:'in_progress'}),/Only assigned people/);
 await assert.rejects(rpc('hub_deliverable_budget',{id:'weekly-246-24h',version:after.version,data:{plannedBudgetCents:1,actualSpendCents:null}}),/Only involved staff/);
 await f.actor('steve');const separate=await f.get('weekly-246-2h');const kept=separate.references.filter(url=>!url.endsWith('card.jpg'));
 await f.save({id:'weekly-246-2h',version:separate.version,data:{...deliverableDraft(separate),contributors:[],references:kept,linkRoles:Object.fromEntries(kept.map(url=>[url,'reference']))},metadata:{priority:separate.priority,notes:separate.notes}});
 assert.deepEqual((await f.get('weekly-246-2h')).contributors,[]);assert.deepEqual((await f.get('weekly-246-2h')).references,kept);
});
test('partial and overallocated budgets are allowed, manual numbering is retained, and a new close uses elapsed DST hours',async()=>{
 await f.actor('jon');const p=payload('weekly-248',248);p.data.closesAt='2026-11-01T21:30';p.plannedBudgets={'48':17500,'24':15000,'2':7500};await create(p);
 let work=await children(p.id);assert.equal(budgetTotals(work).planned,BigInt(40000));assert.equal(allocationLabel(45000,BigInt(40000)),'Unallocated');assert.equal(allocationLabel(45000,BigInt(50000)),'Overallocated');
 for(const {data:d} of work)assert.equal(d.productionDue,{'48':'2026-10-30T22:30','24':'2026-10-31T22:30','2':'2026-11-01T19:30'}[d.reminderHours]);
 await campaign(p.id,{...p.data,name:'Renamed campaign',auction_number:247,campaignBudgetCents:35000});work=await children(p.id);assert.ok(work.every(r=>r.data.title.startsWith('#247 Renamed campaign — ')));assert.equal(nextAuctionNumber(await all('auction_campaign')),248);
 await assert.rejects(campaign(p.id,{...p.data,auction_number:246}),/already exists/);
 await campaign(p.id,{...p.data,auction_number:247,closesAt:'2026-11-08T21:00'});work=await children(p.id);assert.equal(work.find(r=>r.data.reminderHours===48).data.productionDue,'2026-11-06T21:00');
 await f.actor('steve');await campaign('weekly-246',{...original.data,name:'Renamed Jordan',auction_number:250,assignees:[]});assert.equal((await f.get('weekly-246-48h')).title,'Custom reminder title');assert.equal((await f.get('weekly-246-24h')).title,'#250 Renamed Jordan — 24 Hour Reminder');
 assert.equal(campaignGroups(await all('deliverable'))[0].records[0].data.auction_number,250);
});
test('invalid input and an existing reminder ID roll back the complete creation, without orphan campaigns or calendar copies',async()=>{
 await f.actor('steve');const before=await snapshot();
 for(const p of [payload('bad-budget',251),payload('bad-owner',251),payload('bad-url',251),payload('bad-close',251),payload('bad-staff',251)]){
  if(p.id==='bad-budget')p.plannedBudgets['2']=1.5;if(p.id==='bad-owner')p.data.owner='foreign';if(p.id==='bad-url')p.data.assetLinks=['javascript:alert(1)'];if(p.id==='bad-close')p.data.closesAt='2026-10-03T21:00';if(p.id==='bad-staff')p.data.assignees=['foreign'];
  await assert.rejects(create(p));assert.deepEqual(await snapshot(),before);
 }
 await f.hq('save-deliverable',{id:'collision-48h',version:0,data:{...blankDeliverable,owner:'jon',publisher:'jon',projectId:'weekly',title:'Existing unrelated work'}});const collision=await snapshot();await assert.rejects(create(payload('collision',251)),/already exists/);assert.deepEqual(await snapshot(),collision);
 await f.hq('save-project',{id:'other-project',version:0,data:{...blankProject,title:'Other weekly project',type:'weekly_auction',owner:'jon',brief:'Other project',status:'draft'}});await assert.rejects(create({...payload('bad-parent',251),projectId:'other-project'}),/existing Collect Weekly Auctions/);
 assert.equal(createAuctionCampaignCommand.safeParse({action:'create-auction-campaign',...payload('schema')}).success,true);assert.equal(createAuctionCampaignCommand.safeParse({action:'create-auction-campaign',...payload('bad-number',1.5)}).success,false);
});
test('competing submissions create one batch, denied users cannot create, and migration replay keeps all records and history',async()=>{
 await f.actor('steve');const attempts=await Promise.allSettled([create(payload('competing-a',251)),create(payload('competing-b',251))]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal((await all('deliverable')).filter(r=>r.data.auction_number===251).length,3);
 for(const actor of ['outsider','foreign','unsigned']){await f.actor(actor);await assert.rejects(create(payload('denied-'+actor,252)));}
 await f.db.exec('reset role;set role anon');await assert.rejects(create(payload('denied-anon',252)),/permission denied/);
 await f.db.exec('reset role');await f.db.query("select set_config('request.jwt.claim.sub','',false)");const before=await snapshot();await f.db.exec(migration);assert.deepEqual(await snapshot(),before);
});
