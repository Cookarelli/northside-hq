import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auctionDb} from './helpers/auction-db.mjs';
import {deliverableDraft} from '../lib/hq-model.ts';
import {campaignGroups,auctionStatus,auctionStatusOptions,auctionEditorCommand} from '../lib/auction-deliverables.ts';
let f;
before(async()=>{f=await auctionDb();});after(async()=>await f?.db.close());
const payload=(id,d,patch={},metadata={priority:d.priority||'normal',notes:d.notes||''})=>({id,version:d.version,data:{...deliverableDraft(d),...patch},metadata});
async function snapshot(){return {records:(await f.db.query('select * from marketing_records order by workspace_id,kind,id')).rows,activity:(await f.db.query('select * from hq_activity order by id')).rows,notifications:(await f.db.query('select * from hq_notifications order by id')).rows};}
test('groups each auction batch chronologically, includes published work and excludes deleted/task/unrelated work',async()=>{
 const d=await f.get('mj-48'),rows=[48,24,2].map(hours=>({id:'mj-'+hours,data:{...d,reminderHours:hours,productionDue:`2026-09-${hours===48?25:hours===24?26:27}T21:00`}}));
 const groups=campaignGroups([...rows.reverse(),{id:'other-week',data:{...d,auctionClosesAt:'2026-10-04T21:00'}},{id:'deleted',data:{...d,deletedAt:'now'}},{id:'task',data:{...d,workflow:'task'}},{id:'unrelated',data:{...d,campaignReference:''}}]);
 assert.equal(groups.length,2);assert.deepEqual(groups[0].records.map(r=>r.id),['mj-48','mj-24','mj-2']);assert.equal(groups[0].name,'Michael Jordan Consignment');
});
test('single save persists every editor field, preserves campaign metadata, prevents partial writes and stale overwrites',async()=>{
 await f.actor('steve');let d=await f.get('mj-48'),created=d.createdAt;
 d=(await f.save(payload('mj-48',d,{title:'Updated reminder',instructions:'New description',owner:'brody',contributors:['jon','steve'],productionDue:'2026-09-25T20:45',publishAt:'2026-09-25T20:45',destinationUrl:'https://example.test/lot',references:['https://example.test/new-final.mp4'],linkRoles:{'https://example.test/new-final.mp4':'final'}},{priority:'high',notes:'New internal note'}))).data;
 assert.equal(d.title,'Updated reminder');assert.equal(d.instructions,'New description');assert.equal(d.owner,'brody');assert.deepEqual(d.contributors,['jon','steve']);assert.equal(d.productionDue,'2026-09-25T20:45');assert.equal(d.destinationUrl,'https://example.test/lot');assert.deepEqual(d.references,['https://example.test/new-final.mp4']);assert.equal(d.priority,'high');assert.equal(d.notes,'New internal note');assert.equal(d.createdAt,created);assert.equal(d.campaignReference,'Michael Jordan Consignment');assert.deepEqual(d.preservedMetadata,{keep:true});
 await assert.rejects(f.save({...payload('mj-48',d),version:1}),/Someone changed/);
 await f.actor('jon');const before=await snapshot();
 await assert.rejects(f.save(payload('mj-48',d,{instructions:'Should roll back'},{priority:'urgent',notes:d.notes})),/owner or an administrator/);assert.deepEqual(await snapshot(),before);
 d=(await f.save(payload('mj-48',d,{instructions:'Staff edit succeeds'}))).data;assert.equal(d.instructions,'Staff edit succeeds');
 const saved=await snapshot();await f.save(payload('mj-48',d));assert.deepEqual(await snapshot(),saved,'no-op saves must not change approvals, activity or version');
});
test('six statuses follow actual approval and per-platform confirmations; notes-only edits preserve approval and locked content',async()=>{
 await f.actor('jon');let d=await f.get('mj-24'),p=await f.get('weekly','project');
 const context={...(await f.hq('context'))};
 assert.equal(auctionStatus(d,p),'not_started');assert.deepEqual(auctionStatusOptions(d,p,context),['in_progress']);
 d=(await f.hq('production',{id:'mj-24',version:d.version,status:'in_progress'})).data;
 assert.equal(auctionStatus(d,p),'in_progress');
 d=(await f.hq('production',{id:'mj-24',version:d.version,status:'needs_review'})).data;
 assert.equal(auctionStatus(d,p),'review');assert.ok(auctionStatusOptions(d,p,context).includes('approved'));
 await f.actor('joey');assert.ok(auctionStatusOptions(d,p,await f.hq('context')).includes('approved'));
 d=(await f.hq('review',{id:'mj-24',version:d.version,decision:'approve',comment:''})).data;
 assert.equal(auctionStatus(d,p),'approved');const approval=d.approval;
 d=(await f.save(payload('mj-24',d,{}, {priority:'urgent',notes:'Approved internal note'}))).data;assert.deepEqual(d.approval,approval);assert.equal(auctionStatus(d,p),'approved');
 await f.actor('steve');
 const publication=async(platform,status)=>{d=(await f.hq('publication',{id:'mj-24',version:d.version,platform,status,confirmed:true,time:'2026-09-20T19:00',url:status==='published'?'https://example.test/live':'',unavailableReason:''})).data;};
 await publication('facebook','scheduled');assert.equal(auctionStatus(d,p),'approved','partially scheduled is not fully scheduled');
 await publication('instagram','scheduled');assert.equal(auctionStatus(d,p),'scheduled');
 await assert.rejects(f.save(payload('mj-24',d,{instructions:'Locked edit'})),/Cancel|scheduled|published/i);
 await f.db.exec("reset role;update marketing_records set data=jsonb_set(jsonb_set(data,'{productionDue}','\"2026-09-27T02:00:00Z\"'),'{publishAt}','\"2026-09-26T21:00:00-05:00\"') where id='mj-24'");
 await f.actor('steve');d=await f.get('mj-24');d=(await f.save(payload('mj-24',d,{}, {priority:'high',notes:'Metadata on a scheduled legacy timestamp'}))).data;
 assert.equal(d.productionDue,'2026-09-27T02:00:00Z');assert.deepEqual(d.approval,approval);assert.equal(auctionStatus(d,p),'scheduled');
 await publication('facebook','published');assert.equal(auctionStatus(d,p),'scheduled');
 await publication('instagram','published');assert.equal(auctionStatus(d,p),'published');assert.deepEqual(auctionStatusOptions(d,p,await f.hq('context')),[]);
 assert.equal(campaignGroups([{id:'mj-24',data:d}])[0].records.length,1);
});
test('API schema and database enforce agreement, roles, workspace, Chicago dates and migration replay',async()=>{
 await f.actor('steve');const d=await f.get('mj-2'),valid={action:'save-auction-deliverable',...payload('mj-2',d)};
 assert.ok(auctionEditorCommand.safeParse(valid).success);
 for(const patch of [{productionDue:'2026-03-08T02:30'},{destinationUrl:'javascript:alert(1)'},{references:['http://unsafe.test']}])assert.equal(auctionEditorCommand.safeParse({...valid,data:{...valid.data,...patch}}).success,false);
 for(const actor of ['outsider','foreign','unsigned']){await f.actor(actor);await assert.rejects(f.save(payload('mj-2',d,{instructions:'Unauthorized'})),/Only assigned people|not found|signature required/);}
 await f.db.exec('reset role;set role anon');await assert.rejects(f.save(payload('mj-2',d)),/permission denied/);
 await f.db.exec('reset role');const before=await snapshot();await f.db.exec(await readFile(new URL('../supabase/migrations/20260923214155_auction_deliverable_editor.sql',import.meta.url),'utf8'));assert.deepEqual(await snapshot(),before);
 assert.equal((await f.db.query("select count(*) n from marketing_records where kind='deliverable'")).rows[0].n,3);
});
