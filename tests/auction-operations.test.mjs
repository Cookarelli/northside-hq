import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {auctionDb} from './helpers/auction-db.mjs';
import {blankDeliverable,approvalCurrent,deliverableDraft} from '../lib/hq-model.ts';
import {auctionStatus,auctionStatusOptions} from '../lib/auction-deliverables.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
import {budgetTotals,parseUsd,usd,varianceLabel,deliverableBudgetCommand} from '../lib/deliverable-budget.ts';
import {auctionCampaignCommand} from '../lib/auction-campaigns.ts';
let f,migration;const campaignId='mj-consignment-video-2026-09-23';
before(async()=>{f=await auctionDb({numbered:true});const dir=new URL('../supabase/migrations/',import.meta.url);migration=await readFile(new URL((await readdir(dir)).find(name=>name.endsWith('_auction_campaign_permissions_budgets.sql')),dir),'utf8');});
after(async()=>await f?.db.close());
const rpc=async(name,payload)=>(await f.db.query('select '+name+'($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
const rows=async()=>(await f.db.query("select id,data from marketing_records where kind='deliverable' order by id")).rows;
const project=async()=>({id:'weekly',data:await f.get('weekly','project')});
async function snapshot(){return {records:(await f.db.query('select * from marketing_records order by workspace_id,kind,id')).rows,activity:(await f.db.query('select * from hq_activity order by id')).rows,notifications:(await f.db.query('select * from hq_notifications order by id')).rows};}
async function campaign(data){const old=await f.get(campaignId,'auction_campaign');return (await rpc('hub_auction_campaign',{id:campaignId,version:old.version,data})).data;}
async function budget(id,plannedBudgetCents,actualSpendCents){const old=await f.get(id);return (await rpc('hub_deliverable_budget',{id,version:old.version,data:{plannedBudgetCents,actualSpendCents}})).data;}
async function production(id,status){return (await f.hq('production',{id,version:(await f.get(id)).version,status})).data;}
test('backfill attaches #245 to the same three IDs without a project/calendar copy and full replay is a no-op',async()=>{
 await f.actor('steve');const all=await rows();assert.equal(all.length,3);assert.ok(all.every(r=>r.data.auction_number===245&&r.data.auctionCampaignId===campaignId));
 assert.deepEqual(all.map(r=>r.id),['mj-2','mj-24','mj-48']);assert.equal((await f.get(campaignId,'auction_campaign')).auction_number,245);
 assert.equal((await f.db.query("select count(*) n from marketing_records where kind='project'")).rows[0].n,1);
 assert.equal((await f.db.query("select count(*) n from marketing_records where kind='post'")).rows[0].n,0);
 assert.equal((await f.db.query("select count(*) n from hq_activity where action='auction campaign updated' and actor='migration' and not snapshot ? 'campaignOwner'")).rows[0].n,3);
 await f.db.exec('reset role');const before=await snapshot();await f.db.exec(migration);assert.deepEqual(await snapshot(),before);
});
test('calendar derives exactly three numbered reminders with Central dates, staff owner colors and project deep links',async()=>{
 const saved=await rows(),p=await project();const events=calendarEntries(saved,[p],[],[],'2026-09-24','2026-09-28').filter(e=>e.key.endsWith(':reminder'));
 assert.equal(events.length,3);assert.deepEqual(events.map(e=>e.title),['Collect Weekly Auction #245 — 48 Hour Reminder','Collect Weekly Auction #245 — 24 Hour Reminder','Collect Weekly Auction #245 — 2 Hour Reminder']);
 assert.deepEqual(events.map(e=>e.date),['2026-09-25T21:00','2026-09-26T21:00','2026-09-27T19:00']);
 assert.ok(events.every(e=>e.owner==='jon'&&e.deliverableOwnerColor&&e.campaign==='Michael Jordan Consignment'&&e.status==='Not Started'));
 assert.equal(events[0].href,'/projects/weekly?tab=deliverables&deliverable=mj-48#deliverable-mj-48');
 assert.deepEqual(await rows(),saved);
});
test('campaign number/name/close edits update all source deliverables atomically and recalculate elapsed hours across DST',async()=>{
 await f.actor('jon');const p=await project();
 let c=await campaign({name:'Jordan card spotlight',auction_number:246,closesAt:'2026-11-01T21:30'});assert.equal(c.auction_number,246);
 const expected={'mj-48':'2026-10-30T22:30','mj-24':'2026-10-31T22:30','mj-2':'2026-11-01T19:30'};
 for(const r of await rows()){assert.equal(r.data.productionDue,expected[r.id]);assert.equal(r.data.publishAt,expected[r.id]);assert.equal(r.data.auction_number,246);assert.equal(r.data.campaignReference,'Jordan card spotlight');}
 assert.deepEqual(await project(),p,'Campaign edits must not invalidate unrelated project approvals or replace its budget');
 let events=calendarEntries(await rows(),[p],[],[],'2026-10-30','2026-11-01');assert.ok(events.filter(e=>e.key.endsWith(':reminder')).every(e=>e.title.startsWith('#246')&&e.campaign==='Jordan card spotlight'));
 const before=await snapshot();await assert.rejects(rpc('hub_auction_campaign',{id:campaignId,version:1,data:{name:'Stale',auction_number:100,closesAt:'2026-11-01T21:00'}}),/Someone changed/);assert.deepEqual(await snapshot(),before);
 await assert.rejects(campaign({name:'Bad date',auction_number:245,closesAt:'2026-03-08T02:30'}));assert.deepEqual(await snapshot(),before);
 c=await campaign({name:'Michael Jordan Consignment',auction_number:245,closesAt:'2026-09-27T21:00'});
 await f.actor('steve');let d=await f.get('mj-48');d=(await f.hq('save-deliverable',{id:'mj-48',version:d.version,data:{...deliverableDraft(d),title:'New reminder title',owner:'brody',productionDue:'2026-09-25T20:30'}})).data;
 events=calendarEntries(await rows(),[p],[],[],'2026-09-24','2026-09-28');const updated=events.find(e=>e.key==='mj-48:reminder');assert.equal(updated.title,'#245 New reminder title');assert.equal(updated.owner,'brody');assert.equal(updated.date,'2026-09-25T20:30');
 await f.db.exec('reset role');const beforeReplay=await snapshot();await f.db.exec(migration);assert.deepEqual(await snapshot(),beforeReplay,'Replay preserves edited numbering, dates, labels and budgets');
});
test('every involved role can approve and confirm publication, including project-only and deliverable-only staff; unrelated staff cannot',async()=>{
 await f.db.exec("reset role;update marketing_records set data=jsonb_set(data,'{members}','[\"steve\",\"jon\",\"brody\",\"outsider\"]') where kind='project' and id='weekly'");
 for(const [id,actor] of [['project-member','outsider'],['individual-assignee','unsigned'],['administrator','steve']]){
  if(actor==='unsigned'){await f.actor('unsigned');await f.db.query('select hub_agreement_gate()');await f.db.query('select hub_accept_agreement($1,$2,$3,$4)',['20000000-0000-4000-8000-000000000001','unsigned','','test']);}
  await f.actor('steve');await f.hq('save-deliverable',{id,version:0,data:{...blankDeliverable,title:id,instructions:'Prepare the deliverable',owner:'jon',contributors:actor==='unsigned'?['unsigned']:[],projectId:'weekly',productionDue:'2026-09-20T19:00',publishAt:'2026-09-20T19:00',format:'Video',caption:'Approved content',publisher:'jon',requiresFinalFile:false}});
  await f.actor(actor);let d=await production(id,'in_progress');d=await production(id,'needs_review');assert.ok(auctionStatusOptions(d,(await project()).data,await f.hq('context')).includes('approved'));
  d=(await f.hq('review',{id,version:d.version,decision:'approve',comment:''})).data;assert.equal(d.approval.by,actor);assert.ok(approvalCurrent(d,(await project()).data));
  for(const platform of ['facebook','instagram'])d=(await f.hq('publication',{id,version:d.version,platform,status:'scheduled',confirmed:true,time:'2026-09-20T19:00',url:'',unavailableReason:''})).data;
  assert.equal(auctionStatus(d,(await project()).data),'scheduled');
  for(const platform of ['facebook','instagram'])d=(await f.hq('publication',{id,version:d.version,platform,status:'published',confirmed:true,time:'2026-09-20T19:00',url:'https://example.test/'+platform,unavailableReason:''})).data;
  assert.equal(auctionStatus(d,(await project()).data),'published');assert.equal(d.actualSpendCents,undefined,'Actual spend is optional even at publication');
 }
 await f.actor('steve');const d=await f.get('mj-2');await f.db.exec("reset role;update marketing_records set data=jsonb_set(data,'{members}','[\"steve\",\"jon\",\"brody\"]') where kind='project' and id='weekly'");
 for(const actor of ['outsider','foreign']){await f.actor(actor);for(const action of ['production','review','publication'])await assert.rejects(f.hq(action,{id:'mj-2',version:d.version,status:action==='production'?'in_progress':'published',decision:'approve',comment:'',platform:'facebook',confirmed:true,time:'2026-09-20T19:00',url:'https://example.test/live'}));await assert.rejects(rpc('hub_deliverable_budget',{id:'mj-2',version:d.version,data:{plannedBudgetCents:15000,actualSpendCents:null}}));}
 await f.actor('unsigned');await assert.rejects(production('mj-2','in_progress'),/Only assigned people/);await assert.rejects(campaign({name:'Unauthorized campaign edit',auction_number:245,closesAt:'2026-09-27T21:00'}),/Only project members/);
});
test('integer-cent budgets support blanks, zero, over/under, exact rollups and post-publication updates without changing approvals',async()=>{
 assert.equal(parseUsd('142.37'),14237);assert.equal(parseUsd('0.29'),29);assert.equal(parseUsd(''),null);assert.equal(parseUsd('0'),0);
 for(const value of ['-1','1.001','1e2','NaN','9007199254740991'])assert.throws(()=>parseUsd(value));
 assert.equal(usd(BigInt('900719925474099100')),'$9,007,199,254,740,991.00');assert.equal(varianceLabel(BigInt(2500)),'$25.00 under budget');assert.equal(varianceLabel(BigInt(-2500)),'$25.00 over budget');
 await f.actor('jon');await budget('mj-48',15000,14000);await budget('mj-24',15000,14237);await budget('mj-2',15000,null);
 let totals=budgetTotals((await rows()).filter(r=>r.data.auction_number===245));assert.equal(totals.planned,BigInt(45000));assert.equal(totals.actual,BigInt(28237));assert.equal(totals.variance,BigInt(16763));assert.equal(totals.pending,1);
 await budget('mj-2',15000,17500);totals=budgetTotals((await rows()).filter(r=>r.data.auction_number===245));assert.equal(totals.variance,BigInt(-737));
 const old=await f.get('administrator');await budget('administrator',15000,14237);const updated=await f.get('administrator');assert.deepEqual(updated.approval,old.approval);assert.deepEqual(updated.publications,old.publications);
 const before=await snapshot();await assert.rejects(rpc('hub_deliverable_budget',{id:'mj-2',version:(await f.get('mj-2')).version,data:{plannedBudgetCents:1.5,actualSpendCents:null}}),/whole cents/);assert.deepEqual(await snapshot(),before);
 assert.equal(deliverableBudgetCommand.safeParse({action:'deliverable-budget',id:'x',version:1,data:{plannedBudgetCents:1.5,actualSpendCents:null}}).success,false);
 const d=await f.get('mj-48');await assert.rejects(f.save({id:'mj-48',version:d.version,data:{...deliverableDraft(d),instructions:'Must roll back'},metadata:{priority:d.priority,notes:d.notes},budget:{plannedBudgetCents:-1,actualSpendCents:null}}));assert.deepEqual(await snapshot(),before);
});
test('campaign update rolls back around confirmed schedules and budget permission applies to ordinary project tasks',async()=>{
 await f.actor('jon');await production('mj-24','in_progress');await production('mj-24','needs_review');let d=await f.get('mj-24');d=(await f.hq('review',{id:'mj-24',version:d.version,decision:'approve',comment:''})).data;
 await f.hq('publication',{id:'mj-24',version:d.version,platform:'facebook',status:'scheduled',confirmed:true,time:d.publishAt,url:'',unavailableReason:''});const before=await snapshot();
 await assert.rejects(campaign({name:'New close',auction_number:245,closesAt:'2026-10-04T21:00'}),/Cancel confirmed schedules/);assert.deepEqual(await snapshot(),before);
 assert.equal(auctionCampaignCommand.safeParse({action:'save-auction-campaign',id:campaignId,version:1,data:{name:'x',auction_number:245.5,closesAt:'2026-10-04T21:00'}}).success,false);
 await f.actor('steve');await f.db.query("select hub_project_tasks('save-task',$1)",[JSON.stringify({id:'ordinary-task',version:0,data:{title:'Auction photography',instructions:'Prepare photos',projectId:'weekly',assignees:['jon'],productionDue:'2026-09-24T10:00',endAt:'',priority:'normal',notes:''}})]);
 await f.actor('brody');await budget('ordinary-task',5000,null);await f.db.query("select hub_project_tasks('task-status',$1)",[JSON.stringify({id:'ordinary-task',version:(await f.get('ordinary-task')).version,status:'in_progress'})]);assert.equal((await f.get('ordinary-task')).status,'in_progress');
 await f.db.exec('reset role;set role anon');for(const fn of ['hub_auction_campaign','hub_deliverable_budget'])await assert.rejects(rpc(fn,{}),/permission denied/);
});
test('assignment revocation, agreement and active-staff gates remain enforced; replay preserves financial and publication history',async()=>{
 await f.actor('steve');const d=await f.get('mj-2');
 await assert.rejects(f.hq('save-deliverable',{id:'mj-2',version:d.version,data:{...deliverableDraft(d),projectId:'',approver:'steve'}}),/Keep auction deliverables/);
 await f.db.exec("reset role;update private.staff_access set active=false where id='jon'");
 await f.actor('jon');await assert.rejects(budget('mj-2',15000,1));await assert.rejects(production('mj-2','in_progress'));
 await f.db.exec("reset role;update private.staff_access set active=true where id='jon'");
 const before=await snapshot();await f.db.exec(migration);assert.deepEqual(await snapshot(),before);
 const isolated=await auctionDb({numbered:true});
 try{await isolated.actor('unsigned');for(const fn of ['hub_auction_campaign','hub_deliverable_budget'])await assert.rejects(isolated.db.query('select '+fn+'($1::jsonb)',[JSON.stringify({id:'mj-2',version:1,data:{}})]),/agreement/i);}
 finally{await isolated.db.close();}
});
