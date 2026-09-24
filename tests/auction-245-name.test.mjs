import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auctionDb} from './helpers/auction-db.mjs';
import {auctionCalendarTitle,auctionRecordText,numberedAuctionName} from '../lib/auction-campaigns.ts';
import {calendarTabs,calendarTabAliases,selectedTab} from '../lib/hq-tabs.ts';
const label='Collect Weekly Auction #245';
const migration=await readFile(new URL('../supabase/migrations/20260924155834_collect_weekly_auction_245_name.sql',import.meta.url),'utf8');

test('245 rename preserves operational data and archived snapshots, and replay preserves subsequent edits',async()=>{
 const f=await auctionDb({numbered:true});
 try{
  await f.db.exec('reset role');await f.db.query("select set_config('request.jwt.claim.sub','',false)");
  const sourceId='mj-consignment-video-2026-09-23';
  const archived={...(await f.get('weekly','project')),title:'Michael Jordan Consignment Video Campaign',brief:'Michael Jordan consignment brief',status:'archived',migratedToProjectId:'weekly',migrationKey:'old-migration',migrationSnapshot:{title:'Michael Jordan original'}};
  await f.db.query('insert into marketing_records(workspace_id,kind,id,data) values($1,$2,$3,$4::jsonb)',['northside-marketing','project',sourceId,JSON.stringify(archived)]);
  await f.db.query("update marketing_records set data=data||$1::jsonb where kind='deliverable'",[JSON.stringify({campaignMigration:{sourceProject:{title:'Michael Jordan historical title'}},plannedBudgetCents:10000,actualSpendCents:null})]);
  const before=(await f.db.query("select id,data from marketing_records where kind='deliverable' order by id")).rows;
  await f.db.exec(migration);
  assert.equal((await f.get('mj-consignment-video-2026-09-23','auction_campaign')).name,label);
  const source=await f.get(sourceId,'project');assert.equal(source.title,label);assert.equal(source.status,'archived');assert.deepEqual(source.migrationSnapshot,archived.migrationSnapshot);
  assert.equal((await f.db.query("select count(*) n from hq_notifications where record_id in ('mj-48','mj-24','mj-2') and message ilike '%Michael Jordan%'")).rows[0].n,0);
  const textFields=['title','instructions','caption','campaignReference','campaignBrief','notes'];
  for(const r of before){
   const current=await f.get(r.id);
   assert.equal(current.title,`${label} — ${current.reminderHours} Hour Reminder`);
   assert.equal(current.campaignReference,label);
   for(const key of textFields)assert.ok(!/Michael Jordan/i.test(current[key]||''));
   for(const key of ['owner','contributors','productionDue','publishAt','status','approval','publications','assets','references','projectId','auctionCampaignId','campaignMigration','plannedBudgetCents','actualSpendCents'])assert.deepEqual(current[key],r.data[key],key);
  }
  const snapshot=async()=>(await f.db.query('select kind,id,data,updated_at from marketing_records order by kind,id')).rows;
  const saved=await snapshot();await f.db.exec(migration);assert.deepEqual(await snapshot(),saved);
  await f.db.query("update marketing_records set data=jsonb_set(data,'{title}','\"Staff-edited reminder\"') where kind='deliverable' and id='mj-24'");
  const edited=await snapshot();await f.db.exec(migration);assert.deepEqual(await snapshot(),edited);
 }finally{await f.db.close();}
});

test('245 labels, history and number formatting use the requested name without changing other campaigns',()=>{
 assert.equal(auctionRecordText('Michael Jordan Consignment Video Campaign','mj-consignment-video-2026-09-23'),label);
 assert.equal(auctionCalendarTitle({title:'Michael Jordan Auction — 24 Hour Reminder',auction_number:245}),label+' — 24 Hour Reminder');
 assert.equal(numberedAuctionName(label,245),label);
 assert.equal(numberedAuctionName('Another auction',246),'#246 — Another auction');
 assert.equal(auctionRecordText('Michael Jordan highlights','unrelated',246),'Michael Jordan highlights');
});

test('retired release calendar links resolve to schedule and it has no navigation tab',()=>{
 assert.ok(!calendarTabs.some(tab=>tab.id==='releases'));
 assert.equal(selectedTab(calendarTabs,'releases','schedule',calendarTabAliases),'schedule');
});
