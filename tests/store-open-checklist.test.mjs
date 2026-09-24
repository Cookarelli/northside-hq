import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {STORE_OPENING,STORE_OPENING_INSTANT,STORE_OPENING_DATE_LABEL,STORE_OPENING_TIME_LABEL,STORE_OPEN_PLAN_ID,storeOpenPlan} from '../lib/store-opening.ts';
import {projectAreaTabs,projectAreaAliases,selectedTab} from '../lib/hq-tabs.ts';
import {legacyDestination} from '../lib/hq-navigation.ts';
import {auctionDb} from './helpers/auction-db.mjs';

test('store opening is the Chicago milestone regardless of viewer timezone',()=>{
 assert.equal(STORE_OPENING.timeZone,'America/Chicago');
 assert.equal(new Date(STORE_OPENING_INSTANT).toISOString(),'2026-11-20T21:00:00.000Z');
 assert.equal(STORE_OPENING_DATE_LABEL,'Friday, November 20, 2026');
 assert.equal(STORE_OPENING_TIME_LABEL,'3:00 PM CST');
 const saved={budget:2000,launchDate:'2026-11-06',address:'Preserved address',campaign:'existing_campaign',notes:['Keep this note'],assets:['same-file'],owners:['jon']};
 const migrated=storeOpenPlan(saved);
 assert.deepEqual({...migrated,launchDate:saved.launchDate,title:undefined,launchTime:undefined,launchTimezone:undefined},{...saved,title:undefined,launchTime:undefined,launchTimezone:undefined});
 assert.equal(saved.launchDate,'2026-11-06');
 assert.equal(migrated.launchDate,'2026-11-20');
 assert.equal(STORE_OPEN_PLAN_ID,'launch');
});

test('old launch bookmarks reach the single renamed project area',()=>{
 assert.equal(legacyDestination('#launch'),'/projects?tab=store-open-checklist');
 assert.equal(legacyDestination('#store-open-checklist'),'/projects?tab=store-open-checklist');
 assert.equal(selectedTab(projectAreaTabs,'launch','projects',projectAreaAliases),'store-open-checklist');
 assert.equal(selectedTab(projectAreaTabs,'store-open-checklist','projects',projectAreaAliases),'store-open-checklist');
 assert.equal(selectedTab(projectAreaTabs,'constructor','projects',projectAreaAliases),'projects');
 assert.equal(projectAreaTabs.filter(t=>t.label==='Store Open Checklist').length,1);
 assert.equal(projectAreaTabs.some(t=>t.id==='launch'),false);
});

test('existing plan migrates in place, replays safely and survives old-client saves without losing history',async()=>{
 const f=await auctionDb();
 try {
  await f.db.exec('reset role;alter table public.marketing_records disable trigger preserve_store_open_checklist');
  const old={title:'Launch Plan',budget:2000,launchDate:'2026-11-06',launchTime:'14:00',launchTimezone:'America/Chicago',address:'Saved address',campaign:'existing_campaign',aov:95,margin:30,notes:[{body:'Keep the launch note'}],assets:['original-file'],assignments:['jon'],history:[{action:'saved'}],unknown:{keep:true}};
  await f.db.query("insert into marketing_records(workspace_id,kind,id,data) values('northside-marketing','plan','launch',$1),('other-org','plan','launch',$1),('northside-marketing','plan','historical-plan',$1)",[old]);
  await f.db.exec('alter table public.marketing_records enable trigger preserve_store_open_checklist');
  const snapshot=async()=> (await f.db.query('select * from marketing_records order by workspace_id,kind,id')).rows;
  const before=await snapshot();
  const file=(await readdir(new URL('../supabase/migrations/',import.meta.url))).find(f=>f.endsWith('_store_open_checklist.sql'));
  const sql=await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
  await f.db.exec(sql);
  const after=await snapshot();
  assert.equal(after.length,before.length);
  const target=row=>row.workspace_id==='northside-marketing'&&row.kind==='plan'&&row.id==='launch';
  assert.deepEqual(after.filter(r=>!target(r)),before.filter(r=>!target(r)),'projects, deliverables, other workspaces and historical plans are untouched');
  const row=after.find(target),prior=before.find(target);
  assert.deepEqual({...row,data:prior.data},prior,'identity and original timestamps stay intact');
  assert.deepEqual(row.data,{...old,title:'Store Open Checklist',launchDate:'2026-11-20',launchTime:'15:00',launchTimezone:'America/Chicago',legacyLaunchPlanOpening:{title:old.title,launchDate:old.launchDate,launchTime:old.launchTime,launchTimezone:old.launchTimezone}});
  await f.db.exec(sql);assert.deepEqual(await snapshot(),after,'migration replay does not change records');
  await f.actor('jon');
  const oldClient={budget:3000,launchDate:'2026-11-07',address:old.address,campaign:old.campaign,aov:old.aov,margin:old.margin};
  await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['plan','launch',JSON.stringify(oldClient)]);
  const saved=await f.get('launch','plan');
  assert.deepEqual(saved,{...row.data,budget:3000},'old clients can save settings without resetting the official milestone or dropping metadata');
  await f.actor('unsigned');await assert.rejects(f.db.query('select hub_save_record($1,$2,$3::jsonb)',['plan','launch',JSON.stringify(oldClient)]),/agreement/i);
  await f.db.exec('reset role;set role anon');await assert.rejects(f.db.query('select hub_save_record($1,$2,$3::jsonb)',['plan','launch',JSON.stringify(oldClient)]),/permission denied/);
 } finally {await f.db.close();}
});
