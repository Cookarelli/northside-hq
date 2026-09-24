import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {selectedTab,tabHref,projectTabs,assetTabs} from '../lib/hq-tabs.ts';
import {jonAssetIds} from '../lib/hq-assets.ts';
import {auctionDb} from './helpers/auction-db.mjs';

test('tab links preserve filters and record deep links, clear one-time actions, and safely handle unknown tabs',()=>{
 assert.equal(selectedTab(assetTabs,'jons-content','all-assets'),'jons-content');
 assert.equal(selectedTab(projectTabs,'constructor','overview'),'overview');
 assert.equal(selectedTab(projectTabs,null,'deliverables'),'deliverables');
 assert.equal(tabHref('/projects/weekly','create=project&deliverable=mj-48&owner=jon&view=old','budget'),'/projects/weekly?owner=jon&tab=budget');
 assert.equal(tabHref('/projects/weekly','deliverable=mj-48','deliverables'),'/projects/weekly?deliverable=mj-48&tab=deliverables');
 assert.equal(new URL('https://hq.test'+tabHref('/assets','','jons-content')).searchParams.get('tab'),'jons-content');
});
test('Jon content is a deduplicated view of uploaded and assigned assets, without guessing unknown ownership',()=>{
 const record=(kind,id,data)=>({kind,id,data});
 const records=[record('asset','upload',{uploadedBy:'jon'}),record('asset','unknown',{}),record('asset','other',{uploadedBy:'brody'}),record('deliverable','work',{owner:'brody',contributors:['jon'],assets:['shared','shared']}),record('project','parent',{members:['jon'],assets:['parent-file']}),record('auction_campaign','auction',{owner:'jon',assets:['campaign-file']}),record('clipjob','legacy',{owner:'jon',assets:['ignored']})];
 const before=JSON.stringify(records);assert.deepEqual([...jonAssetIds(records)].sort(),['campaign-file','parent-file','shared','upload']);assert.equal(JSON.stringify(records),before);
});
test('retired cutting writes are rejected in the database; original history and authenticated uploads remain intact',async()=>{
 const f=await auctionDb();
 try{
  await f.db.exec("reset role;insert into public.marketing_records(workspace_id,kind,id,data) values('northside-marketing','clipjob','history','{\"name\":\"Historical edit\",\"clips\":[{\"start\":1,\"end\":9}]}')");
  const before=await f.get('history','clipjob');
  const file=(await readdir(new URL('../supabase/migrations/',import.meta.url))).find(f=>f.endsWith('_assets_retire_clip_workflow.sql'));
  await f.db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await f.actor('jon');
  for(const id of ['history','new-job'])await assert.rejects(f.db.query('select hub_save_record($1,$2,$3::jsonb)',['clipjob',id,JSON.stringify({name:'Changed'})]),/retired/);
  assert.deepEqual(await f.get('history','clipjob'),before);
  const id=crypto.randomUUID(),upload={id,key:'northside-marketing/'+id,name:'sample.png',type:'image/png',size:12,createdAt:'2026-09-24T03:00:00Z',uploadedBy:'steve'};
  await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['upload',id,JSON.stringify(upload)]);
  const pending=await f.get(id,'upload');assert.equal(pending.uploadedBy,'jon');
  await f.actor('steve');await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['upload',id,JSON.stringify(upload)]);assert.equal((await f.get(id,'upload')).uploadedBy,'jon');
  await assert.rejects(f.db.query('select hub_save_record($1,$2,$3::jsonb)',['upload',id,JSON.stringify({...upload,name:'changed.png'})]),/immutable/);
  await f.db.exec('reset role');await f.db.query("insert into storage.objects values(gen_random_uuid(),$1,'marketing-assets',$2::jsonb)",[pending.key,JSON.stringify({size:12,mimetype:'image/png'})]);
  await f.actor('jon');await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['asset',id,JSON.stringify(pending)]);await f.db.query('select hub_save_record($1,$2,$3::jsonb)',['asset',id,JSON.stringify(pending)]);
  assert.deepEqual(await f.get(id,'asset'),pending);
  await f.actor('unsigned');await assert.rejects(f.db.query('select hub_save_record($1,$2,$3::jsonb)',['upload',crypto.randomUUID(),JSON.stringify(upload)]));
  await f.actor('foreign');assert.equal(await f.get(id,'asset'),undefined);
 }finally{await f.db.close();}
});
