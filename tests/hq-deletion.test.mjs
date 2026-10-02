import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auctionDb} from './helpers/auction-db.mjs';
import {blankProject,blankDeliverable,projectDraft,deliverableDraft,hqCommand} from '../lib/hq-model.ts';
import {canDeleteRecord,attachedDeliverableCount,applyDeletedRecord} from '../lib/hq-deletion.ts';
import {scheduleRows,todayDashboard} from '../lib/hq-operations.ts';
import {calendarEntries} from '../lib/hq-calendar.ts';
import {assignmentGroups} from '../lib/hq-presentation.ts';
import {checklistWork} from '../lib/store-open-work.ts';
import {hqApi} from './helpers/hq-api.mjs';
let f,api;
before(async()=>{f=await auctionDb();api=await hqApi(f);});
after(async()=>{api?.close();await f?.db.close();});
async function rpc(name,action,payload){return (await f.db.query(`select ${name}($1,$2::jsonb) result`,[action,JSON.stringify(payload)])).rows[0].result;}
async function remove(kind,id,version){return rpc('hub_hq_delete','delete-'+kind,{id,version:version??(await f.get(id,kind)).version,confirmed:true});}
async function project(id,owner='joey'){return (await f.hq('save-project',{id,version:0,data:{...blankProject,title:'Project '+id,owner,brief:'Deletion test',status:'active',members:['jon','brody'],eventAt:'2026-10-02T12:00',storeOpenChecklist:true}})).data;}
async function deliverable(id,projectId='',owner='jon'){return (await f.hq('save-deliverable',{id,version:0,data:{...blankDeliverable,title:'Deliverable '+id,owner,contributors:['brody'],projectId,approver:projectId?'':'joey',publisher:'brody',instructions:'Deletion test',productionDue:'2026-10-02T09:00',publishAt:'2026-10-02T12:00',format:'Image',requiresFinalFile:false,caption:'Keep the evidence'}})).data;}
const context=staffId=>({staffId,admin:staffId==='steve',staff:[]});

test('confirmed commands are strict and item ownership differs from membership or authorship',()=>{
 for(const action of ['delete-project','delete-deliverable']){
  assert.ok(hqCommand.safeParse({action,id:'item',version:1,confirmed:true}).success);
  for(const patch of [{confirmed:false},{confirmed:undefined},{version:0},{id:'bad/id'},{actor:'steve'}])assert.equal(hqCommand.safeParse({action,id:'item',version:1,confirmed:true,...patch}).success,false);
 }
 const data={owner:'jon',createdBy:'joey'};
 assert.ok(canDeleteRecord(data,context('jon')));assert.ok(canDeleteRecord(data,context('steve')));
 assert.equal(canDeleteRecord(data,context('joey')),false);assert.equal(canDeleteRecord(data,context('brody')),false);
 assert.equal(canDeleteRecord({...data,deletedAt:'now'},context('steve')),false);
 assert.ok(canDeleteRecord({...data,owner:''},context('joey')));
});

test('database denies contributors, publishers, project owners, unrelated staff and cross-org users; owner and admin succeed',async()=>{
 await f.actor('steve');await project('permission');const d=await deliverable('owned','permission');
 for(const actor of ['joey','brody','outsider','foreign']){await f.actor(actor);await assert.rejects(remove('deliverable','owned',d.version),/Only the item owner|not found/);}
 await f.actor('jon');const deleted=await remove('deliverable','owned');assert.equal(deleted.data.deletedBy,'jon');
 await f.actor('brody');await assert.rejects(remove('project','permission'),/Only the item owner/);
 await f.actor('joey');assert.equal((await remove('project','permission')).data.deletedBy,'joey');
 await f.actor('steve');await project('admin');await deliverable('admin-owned');
 assert.equal((await remove('deliverable','admin-owned')).data.deletedBy,'steve');
 assert.equal((await remove('project','admin')).data.deletedBy,'steve');
});

test('anonymous, unverified, inactive and unsigned users cannot delete or bypass RPC with direct table writes',async()=>{
 await f.actor('steve');const d=await deliverable('gated');
 await f.db.exec('reset role;set role anon');await assert.rejects(remove('deliverable','gated',d.version),/permission denied/);
 await f.actor('unsigned');await assert.rejects(remove('deliverable','gated',d.version));
 await f.db.exec("reset role;update private.staff_access set active=false where id='jon'");
 await f.actor('jon');await assert.rejects(remove('deliverable','gated',d.version),/Staff access/);
 await f.db.exec("reset role;update private.staff_access set active=true where id='jon';update auth.users set email_confirmed_at=null where email='jon@example.test'");
 await f.actor('jon');await assert.rejects(remove('deliverable','gated',d.version),/Staff access/);
 await f.db.exec("reset role;update auth.users set email_confirmed_at=now() where email='jon@example.test'");
 await f.actor('jon');await assert.rejects(f.db.exec("delete from marketing_records where id='gated'"),/permission denied/);
 await assert.rejects(f.db.exec("update marketing_records set data=data||'{\"deletedAt\":\"fake\"}' where id='gated'"),/permission denied/);
 assert.equal((await f.get('gated')).deletedAt,undefined);
});

test('linked deliverables block projects for admins too, including complete/published work; moving or individual deletion clears the guard',async()=>{
 await f.actor('steve');await project('linked');await project('destination');
 const done=await deliverable('complete-child','linked');
 await f.db.exec("reset role;update marketing_records set data=data||'{\"status\":\"done\",\"publications\":{\"facebook\":{\"status\":\"published\",\"liveUrl\":\"https://example.test/live\"}}}' where id='complete-child'");
 await f.actor('steve');const moving=await deliverable('moving-child','linked');
 await assert.rejects(remove('project','linked'),/2 attached deliverable/);
 await f.hq('save-deliverable',{id:'moving-child',version:moving.version,data:{...deliverableDraft(moving),projectId:'destination'}});
 await assert.rejects(remove('project','linked'),/1 attached deliverable/);
 await f.actor('jon');const deleted=await remove('deliverable','complete-child');assert.equal(deleted.data.publications.facebook.liveUrl,'https://example.test/live');
 await f.actor('joey');const result=await remove('project','linked');assert.ok(result.data.deletedAt);
 assert.equal((await f.get('moving-child')).projectId,'destination');assert.equal((await f.get('complete-child')).projectId,'linked');
 assert.equal(attachedDeliverableCount('linked',[{id:'complete-child',data:deleted.data},{id:'moving-child',data:await f.get('moving-child')}]),0);
 assert.equal(done.owner,'jon');
});

test('stale names/versions and missing confirmation fail, retries preserve the first audit actor/time',async()=>{
 await f.actor('steve');const old=await deliverable('stale');
 const renamed=(await f.hq('save-deliverable',{id:'stale',version:old.version,data:{...deliverableDraft(old),title:'Changed after opening confirmation'}})).data;
 await f.actor('jon');await assert.rejects(remove('deliverable','stale',old.version),/changed.*Reload/);
 await assert.rejects(rpc('hub_hq_delete','delete-deliverable',{id:'stale',version:renamed.version}),/Confirm/);
 const result=await remove('deliverable','stale');await f.actor('steve');const retry=await remove('deliverable','stale',renamed.version);
 assert.deepEqual(retry,result);
 const history=(await f.db.query("select * from hq_activity where record_id='stale' and action='delete-deliverable'")).rows;
 assert.equal(history.length,1);assert.equal(history[0].kind,'deliverable');assert.equal(history[0].snapshot.title,renamed.title);assert.equal(history[0].actor,'jon');assert.equal(history[0].record_id,'stale');assert.ok(history[0].created_at);assert.ok(result.data.deletedAt);
});

test('files, comments, spend, publication evidence and references survive; all notifications resolve; deleted rows cannot be edited',async()=>{
 await f.actor('steve');await project('retention');let d=await deliverable('retained','retention');
 await rpc('hub_hq_operations','comment',{id:'retained',kind:'deliverable',commentId:crypto.randomUUID(),body:'Keep this comment',mentions:['jon']});
 await f.actor('joey');await rpc('hub_hq_operations','spend',{id:crypto.randomUUID(),projectId:'retention',category:'creative',amountCents:2500,spentOn:'2026-10-02',channel:'',note:'Keep this invoice'});
 await f.db.exec("reset role;insert into marketing_records(workspace_id,kind,id,data) values('northside-marketing','asset','retained-file','{\"name\":\"retained.png\",\"assignedDeliverableId\":\"retained\",\"assignedProjectId\":\"retention\"}');insert into storage.objects values(gen_random_uuid(),'northside-marketing/retained.png','marketing-assets','{}');update marketing_records set data=data||'{\"assets\":[\"retained-file\"],\"references\":[\"https://example.test/source\"]}' where kind='deliverable' and id='retained'");
 await f.actor('jon');d=await f.get('retained');const deleted=(await remove('deliverable','retained')).data;
 assert.deepEqual(deleted.assets,d.assets);assert.deepEqual(deleted.references,d.references);
 assert.deepEqual(await f.get('retained-file','asset'),{name:'retained.png',assignedDeliverableId:'retained',assignedProjectId:'retention'});
 assert.equal((await f.db.query("select * from hq_comments where record_id='retained'")).rows[0].body,'Keep this comment');
 await f.db.exec('reset role');
 assert.equal((await f.db.query("select * from hq_notifications where record_id='retained' and resolved_at is null")).rows.length,0);
 await f.actor('jon');
 await rpc('hub_hq_operations','reminders',{});
 assert.equal((await f.db.query("select * from hq_notifications where record_id='retained' and resolved_at is null")).rows.length,0);
 await assert.rejects(f.hq('save-deliverable',{id:'retained',version:deleted.version,data:deliverableDraft(deleted)}));
 await assert.rejects(rpc('hub_hq_operations','comment',{id:'retained',kind:'deliverable',commentId:crypto.randomUUID(),body:'New comment',mentions:[]}),/deleted/);
 await f.actor('joey');const p=await f.get('retention','project');await remove('project','retention');
 assert.equal((await f.db.query("select * from hq_spend where project_id='retention'")).rows[0].amount_cents,2500);
 await assert.rejects(f.hq('save-project',{id:'retention',version:p.version+1,data:{...projectDraft(p),title:'Undelete bypass'}}),/deleted/);
 await assert.rejects(rpc('hub_hq_operations','spend',{id:crypto.randomUUID(),projectId:'retention',category:'creative',amountCents:100,spentOn:'2026-10-02',channel:'',note:'No new charge'}),/deleted/);
 await assert.rejects(rpc('hub_project_tasks','task-restore',{id:'retained',version:deleted.version}),/project is deleted/);
 await f.db.exec('reset role');assert.equal((await f.db.query("select * from storage.objects where name='northside-marketing/retained.png'")).rows.length,1);
});

test('legacy task-delete cannot broaden permissions; new tasks and moves cannot attach to a deleted project',async()=>{
 await f.actor('steve');await project('task-parent');
 const data={title:'Owner task',instructions:'',projectId:'task-parent',assignees:['jon','brody'],productionDue:'',endAt:'',priority:'normal',notes:''};
 let d=(await rpc('hub_project_tasks','save-task',{id:'owner-task',version:0,data})).data;
 await f.actor('joey');await assert.rejects(rpc('hub_project_tasks','task-delete',{id:'owner-task',version:d.version}),/Only the item owner/);
 await f.actor('jon');d=(await rpc('hub_project_tasks','task-delete',{id:'owner-task',version:d.version})).data;assert.equal(d.deletedBy,'jon');
 await f.actor('joey');d=(await rpc('hub_project_tasks','task-restore',{id:'owner-task',version:d.version})).data;assert.equal(d.deletedAt,undefined);
 await f.actor('jon');await remove('deliverable','owner-task');await f.actor('joey');await remove('project','task-parent');
 await f.actor('steve');await assert.rejects(rpc('hub_project_tasks','save-task',{id:'late-child',version:0,data}),/project is deleted/);
 await assert.rejects(deliverable('late-publishing','task-parent'),/project is deleted/);
 const move=await deliverable('late-move');await assert.rejects(f.hq('save-deliverable',{id:'late-move',version:move.version,data:{...deliverableDraft(move),projectId:'task-parent'}}),/project is deleted/);
});

test('deletion immediately removes work from calendar, schedules, dashboard, assignments and checklist without reviving adopted legacy rows',async()=>{
 const now=Date.parse('2026-10-02T15:00:00Z');
 await f.actor('steve');let p=await project('views');let d=await deliverable('view-item','views');
 const rows=[{kind:'project',id:'views',data:p},{kind:'deliverable',id:'view-item',data:{...d,legacyPostId:'legacy'}}];
 const deleted=await remove('deliverable','view-item');deleted.data.legacyPostId='legacy';
 const next=applyDeletedRecord(rows,deleted),work=next.filter(r=>r.kind==='deliverable'),projects=next.filter(r=>r.kind==='project');
 assert.ok(scheduleRows([rows[1]],projects,'production').length);
 for(const mode of ['production','publication'])assert.equal(scheduleRows(work,projects,mode).length,0);
 const legacy=[{id:'legacy',data:{title:'Adopted',date:'2026-10-02T12:00',source:'facebook',status:'draft'}}];
 assert.equal(calendarEntries(work,projects,legacy,[],'2026-10-01','2026-10-31').filter(r=>r.key.startsWith('view-item')||r.key.startsWith('legacy:')).length,0);
 for(const staff of ['jon','brody','joey'])assert.equal(assignmentGroups(work,projects,staff,now).groups.length,0);
 const dash=todayDashboard(work,projects,'jon',now);for(const key of ['dueSoon','approvals','publishing','overdue','blocked','ready'])assert.equal(dash[key].length,0,key);
 assert.ok(dash.missingProjects.every(p=>p.missing.every(text=>!text.includes('view-item'))));
 p=(await remove('project','views')).data;
 assert.equal(checklistWork([{kind:'project',id:'views',data:p},...work]).items.length,0);
 assert.equal(assignmentGroups(work,[{id:'views',data:p}],'joey',now).projects.length,0);
 assert.equal(calendarEntries(work,[{id:'views',data:p}],[],[],'2026-10-01','2026-10-31').filter(r=>!r.milestone).length,0);
 assert.equal(todayDashboard(work,[{id:'views',data:p}],'joey',now).missingProjects.length,0);
});

test('actual API route enforces origin, identity, confirmation, permissions and conflict responses',async()=>{
 await f.actor('steve');const d=await deliverable('api-item');
 const command={action:'delete-deliverable',id:'api-item',version:d.version,confirmed:true};
 assert.equal((await api.post(command,'https://other.example.test')).status,403);
 api.signedIn(false);assert.equal((await api.post(command)).status,401);api.signedIn(true);
 assert.equal((await api.post({...command,confirmed:false})).status,400);
 await f.actor('brody');assert.equal((await api.post(command)).status,403);
 await f.actor('jon');assert.equal((await api.post({...command,version:99})).status,409);
 const response=await api.post(command);assert.equal(response.status,200);assert.equal(response.body.data.deletedBy,'jon');assert.equal(response.body.kind,'deliverable');
 await f.actor('steve');await project('api-linked');await deliverable('api-child','api-linked');
 const denied=await api.post({action:'delete-project',id:'api-linked',version:1,confirmed:true});assert.equal(denied.status,400);assert.match(denied.body.error,/1 attached deliverable/);
});

test('auction deletion retains channel ledger and historical parent without purging spend',async()=>{
 await f.actor('steve');
 const payload={id:'retained-auction',projectId:'weekly',data:{auction_number:900,name:'Retention auction',closesAt:'2026-10-04T21:00',owner:'jon',assignees:['brody'],featuredCard:'Test card',auctionPlatform:'Collect',auctionUrl:'https://example.test/auction',lotUrls:[],assetLinks:[],internalNotes:'Retain evidence',campaignBudgetCents:30000},plannedBudgets:{'48':10000,'24':10000,'2':10000}};
 await f.db.exec('reset role');
 // Model the historical source link used by the existing permanent-auction-parent check.
 await f.db.query("insert into marketing_records(workspace_id,kind,id,data) values('northside-marketing','auction_campaign','retention-origin',$1::jsonb)",[JSON.stringify({...payload.data,auction_number:899,projectId:'weekly',sourceProjectId:'mj-consignment-video-2026-09-23',version:1})]);
 await f.actor('steve');
 await f.db.query('select hub_create_auction_campaign($1::jsonb)',[JSON.stringify(payload)]);
 await f.actor('jon');const id='retained-auction-48h',entryId=crypto.randomUUID();
 await rpc('hub_auction_finance','spend',{id:entryId,deliverableId:id,version:(await f.get(id)).version,channel:'Meta',amountCents:1234,spentOn:'2026-09-20',note:'Retain channel invoice'});
 const original=await f.get(id);await remove('deliverable',id);
 const retained=await f.get(id);assert.equal(retained.actualSpendCents,original.actualSpendCents);assert.equal(retained.plannedBudgetCents,10000);
 const ledger=await rpc('hub_auction_finance','list',{deliverableId:id,offset:0});assert.equal(ledger.entries.find(e=>e.id===entryId).amount_cents,1234);
 assert.ok(await f.get('retained-auction','auction_campaign'));assert.ok(await f.get('weekly','project'));
 await assert.rejects(rpc('hub_auction_finance','spend',{id:crypto.randomUUID(),deliverableId:id,version:retained.version,channel:'Meta',amountCents:100,spentOn:'2026-09-20',note:'Blocked'}),/Restore/);
 await assert.rejects(rpc('hub_auction_finance','reverse',{id:crypto.randomUUID(),deliverableId:id,version:retained.version,reverses:entryId,note:'Blocked'}),/Restore/);
});

test('project review invalidation skips deleted children; both serialized create/delete orderings keep the project invariant',async()=>{
 await f.actor('steve');await project('invalidation');await deliverable('deleted-ready','invalidation');
 await f.db.exec("reset role;update marketing_records set data=data||'{\"status\":\"ready\"}' where id='deleted-ready'");
 await f.actor('steve');const removed=(await remove('deliverable','deleted-ready')).data,p=await f.get('invalidation','project');
 await f.hq('save-project',{id:'invalidation',version:p.version,data:{...projectDraft(p),brief:'Project still editable'}});
 assert.deepEqual(await f.get('deleted-ready'),removed);
 await project('delete-first');await remove('project','delete-first');await assert.rejects(deliverable('after-delete','delete-first'),/project is deleted/);
 await project('create-first');await deliverable('before-delete','create-first');await assert.rejects(remove('project','create-first'),/1 attached deliverable/);
});

test('migration replay preserves all canonical rows, audit events, comments, spend, notifications and storage',async()=>{
 await f.db.exec('reset role');
 const snapshot=async()=>Promise.all(['marketing_records','hq_activity','hq_comments','hq_spend','hq_notifications'].map(async table=>(await f.db.query(`select * from ${table} order by id`)).rows));
 const before=await snapshot();await f.db.exec(await readFile(new URL('../supabase/migrations/20261002134057_hq_record_deletion.sql',import.meta.url),'utf8'));assert.deepEqual(await snapshot(),before);
});
