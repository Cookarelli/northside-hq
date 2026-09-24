import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auctionNavigation,projectSections,projectTabHref,recordActionHref} from '../lib/hq-project-navigation.ts';
import {blankProject,blankDeliverable} from '../lib/hq-model.ts';
import {deliverableHref} from '../lib/auction-campaigns.ts';
import {tabHref} from '../lib/hq-tabs.ts';
import {auctionDb} from './helpers/auction-db.mjs';

const campaign=(id,number,date,reconciled=false)=>({id,data:{auction_number:number,closesAt:date,reconciliation:reconciled?{at:'2026-09-20'}:null}});
test('current auction chooses the next close, keeps unfinished work reachable, and separates history from upcoming auctions',()=>{
 const past=campaign('244',244,'2026-09-20T21:00'),next=campaign('245',245,'2026-09-27T21:00'),future=campaign('246',246,'2026-10-04T21:00'),done=campaign('243',243,'2026-09-13T21:00',true);
 const records=[future,done,next,past],before=JSON.stringify(records);
 const now=Date.parse('2026-09-24T12:00:00Z'),result=auctionNavigation(records,now);
 assert.equal(result.current.id,'245');assert.deepEqual(result.history.map(c=>c.id),['244','243']);assert.deepEqual(result.upcoming.map(c=>c.id),['246']);
 assert.equal(auctionNavigation([past,done],now).current.id,'244');
 assert.equal(auctionNavigation([done],now).current,undefined);assert.equal(auctionNavigation([done],now).history.length,1);
 assert.equal(auctionNavigation([],now).current,undefined);assert.equal(JSON.stringify(records),before);
});
test('project tabs show real files and work, and omit unavailable asset and history areas',()=>{
 const project={id:'p',data:{...blankProject}},task={id:'d',data:{...blankDeliverable,projectId:'p'}};
 const tabs=(work=[],assets=[],weekly=false,create=false,history=false,campaigns=[])=>projectSections(project,work,assets,weekly,create,history,campaigns).map(t=>t.id);
 assert.ok(!tabs().includes('assets'));assert.ok(!tabs().includes('deliverables'));
 assert.ok(tabs([],[],false,true).includes('deliverables'));
 assert.ok(tabs([task]).includes('deliverables'));
 assert.ok(tabs([],[{data:{assignedProjectId:'p'}}]).includes('assets'));
 assert.ok(tabs([{...task,data:{...task.data,references:['https://example.test/file']}}]).includes('assets'));
 assert.ok(!tabs([],[],true).includes('auction-history'));assert.ok(tabs([],[],true,false,true).includes('auction-history'));
 assert.ok(tabs([],[],true,false,false,[{data:{projectId:'p',assetLinks:['https://example.test/asset']}}]).includes('assets'));
});
test('links reach the clicked work, budget or discussion and drop incompatible navigation context',()=>{
 assert.equal(deliverableHref('d',{...blankDeliverable,projectId:'p'}),'/projects/p?tab=deliverables&deliverable=d#deliverable-d');
 assert.equal(deliverableHref('standalone',blankDeliverable),'/projects/work/standalone');
 assert.equal(projectTabHref('p','budget',{auction:'245'}),'/projects/p?tab=budget&auction=245');
 assert.equal(recordActionHref('project','p','spend'),'/projects/p?tab=budget&scope=project');
 assert.equal(recordActionHref('deliverable','d','comment'),'/projects/work/d?tab=notes');
 assert.equal(recordActionHref('request','r','accepted'),'/requests/r?tab=request');
 assert.equal(tabHref('/projects/p','tab=budget&scope=project&auction=245&deliverable=d','assets'),'/projects/p?tab=assets');
 assert.equal(tabHref('/projects/p','tab=auction-history&auction=244','current-auction'),'/projects/p?tab=current-auction');
 assert.equal(recordActionHref('deliverable','d','publication'),'/projects/work/d?tab=publishing');
});
test('project members and individually assigned staff retain task status access; unrelated and unsigned staff do not',async()=>{
 const f=await auctionDb();
 const command=async(action,payload)=>(await f.db.query('select hub_project_tasks($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
 try{
  await f.actor('steve');
  await command('save-task',{id:'navigation-task',version:0,data:{title:'Navigation task',instructions:'Check status access',projectId:'weekly',assignees:['outsider'],productionDue:'',endAt:'',priority:'normal',notes:''}});
  const status=async(value)=>command('task-status',{id:'navigation-task',version:(await f.get('navigation-task')).version,status:value});
  await f.actor('jon');await status('in_progress');assert.equal((await f.get('navigation-task')).status,'in_progress');
  await f.actor('outsider');await status('complete');assert.equal((await f.get('navigation-task')).status,'done');
  await f.actor('steve');await f.hq('save-project',{id:'unrelated',version:0,data:{...blankProject,title:'Unrelated',owner:'joey',members:[],status:'draft'}});
  await command('save-task',{id:'unrelated-task',version:0,data:{title:'Private status test',instructions:'',projectId:'unrelated',assignees:['joey'],productionDue:'',endAt:'',priority:'normal',notes:''}});
  await f.actor('outsider');await assert.rejects(command('task-status',{id:'unrelated-task',version:(await f.get('unrelated-task')).version,status:'complete'}));
  await f.actor('unsigned');await assert.rejects(command('task-status',{id:'navigation-task',version:3,status:'in_progress'}));
 }finally{await f.db.close();}
});
