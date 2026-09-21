import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankDeliverable, blankProject} from '../lib/hq-model.ts';
import {chicagoInstant} from '../lib/consignment.ts';
import {calendarHref, greeting, overviewActivity, overviewAgenda, overviewAttention, overviewCampaigns, overviewComplete, overviewRange, overviewSources} from '../lib/hq-overview.ts';
const now=chicagoInstant('2026-03-08T12:00');
const meta={version:1,createdAt:'2026-03-01T12:00:00Z',updatedAt:'2026-03-01T12:00:00Z',createdBy:'owner'};
const project=(id='p',patch={})=>({kind:'project',id,data:{...blankProject,...meta,title:id,owner:'owner',brief:'Saved brief',status:'active',budget:null,...patch}});
const work=(id='w',patch={})=>({kind:'deliverable',id,data:{...blankDeliverable,...meta,title:id,owner:'maker',publisher:'maker',projectId:'p',instructions:'Saved task',status:'in_progress',approval:null,publications:{},contentVersion:1,...patch}});
const post=(id='post',patch={})=>({kind:'post',id,data:{title:id,date:'2026-03-08T15:00',source:'facebook',platforms:['facebook','instagram'],caption:'Saved copy',status:'draft',...patch}});
const source=(records=[])=>overviewSources(records);

test('empty sources stay empty and never import the default launch plan',()=>{
 const s=source();assert.equal(s.launch,undefined);
 assert.deepEqual(overviewAgenda(s,'2026-03-08','2026-03-14'),[]);
 assert.deepEqual(overviewAttention(s,{records:[]},now),[]);
 assert.deepEqual(overviewCampaigns(s),[]);
 assert.deepEqual(overviewActivity(s,new Map(),now),[]);
});
test('adopted campaigns and posts appear once under their current HQ source',()=>{
 const s=source([project('p',{legacyCampaignId:'c'}),work('w',{legacyPostId:'post',publishAt:'2026-03-08T15:00'}),post(),{kind:'campaign',id:'c',data:{name:'Old campaign'}}]);
 assert.equal(s.campaigns.length,0);assert.equal(s.posts.length,0);
 assert.equal(overviewAgenda(s,'2026-03-08','2026-03-14').length,1);
});
test('agenda counts posts once per time, retains task deadlines and campaign milestones',()=>{
 const s=source([project('p',{type:'weekly_auction',auctionOpensAt:'2026-03-08T10:00',auctionClosesAt:'2026-03-14T20:00'}),work('w',{productionDue:'2026-03-08T13:00',publishAt:'2026-03-08T15:00'}),post()]);
 const rows=overviewAgenda(s,'2026-03-08','2026-03-14');
 assert.equal(rows.length,5);assert.equal(rows.filter(r=>r.label==='Planned post').length,1);
 assert.equal(rows.filter(r=>r.label==='Task due').length,1);
 assert.ok(rows.some(r=>r.label==='Auction closes'));
});
test('confirmed platform times override a planned time, without inflating counts',()=>{
 const s=source([work('w',{publishAt:'2026-03-08T10:00',publications:{facebook:{status:'published',publishedAt:'2026-03-08T11:00'},instagram:{status:'scheduled',scheduledFor:'2026-03-09T15:00'}}})]);
 assert.deepEqual(overviewAgenda(s,'2026-03-08','2026-03-14').map(r=>r.date),['2026-03-08T11:00','2026-03-09T15:00']);
});
test('an absent platform confirmation cannot complete a task or consignment stage',()=>{
 const d=work('partial',{platforms:['facebook','instagram'],publications:{facebook:{status:'published'}}});
 assert.equal(overviewComplete(d.data),false);
 const s=source([project('p',{legacyCampaignId:'legacy'}),{...d,data:{...d.data,legacyPost:{consignment:{stage:'opening'}}}}]);
 assert.equal(overviewCampaigns(s)[0].completed,0);
});
test('seven-day agenda respects Central dates, DST, inclusive end, and recurring Tuesday templates',()=>{
 const s=source([post('series',{date:'2026-03-03T09:00',recurrence:'weekly-tuesday'}),post('last',{date:'2026-03-14T23:59'}),post('next',{date:'2026-03-15T00:00'}),post('gap',{date:'2026-03-08T02:30'}),post('invalid',{date:'not a date'})]);
 assert.deepEqual(overviewAgenda(s,'2026-03-08','2026-03-14').map(r=>r.date),['2026-03-10T09:00','2026-03-14T23:59']);
 assert.equal(greeting(Date.parse('2026-03-08T06:30:00Z')),'Good morning');
 assert.equal(greeting(chicagoInstant('2026-03-08T12:00')),'Good afternoon');
 assert.equal(greeting(chicagoInstant('2026-03-08T17:00')),'Good evening');
});
test('attention deduplicates reasons per work record and omits completed or archived work',()=>{
 const s=source([project(),project('archived',{status:'archived'}),work('blocked',{blocked:true,blockedReason:'Missing photos',status:'needs_review',productionDue:'2026-03-08T10:00'}),work('done',{status:'done'}),work('archived',{projectId:'archived',productionDue:'2026-03-07T10:00'})]);
 const rows=overviewAttention(s,{records:[]},now);assert.equal(rows.length,1);assert.equal(rows[0].key,'work:blocked');assert.equal(rows[0].reason,'Missing photos');assert.equal(rows[0].action,'Resolve');
});
test('attention includes overdue tasks, due stages, unassigned work, and editorial reviews',()=>{
 const s=source([project(),work('late',{productionDue:'2026-03-08T10:00'}),work('stage',{publishAt:'2026-03-10T10:00',legacyPost:{consignment:{stage:'midweek'}}}),work('owner',{owner:''}),work('adopted',{legacyEditorialId:'q2'}),post('review',{status:'review'}),post('recurring',{status:'review',recurrence:'weekly-tuesday'})]);
 const editorial={records:[{id:'q1',kind:'queue',data:{title:'Post',state:'Needs review',assignee:'maker',calendarDate:''}},{id:'q2',kind:'queue',data:{title:'Adopted',state:'Needs review'}}]};
 const rows=overviewAttention(s,editorial,now);
 assert.deepEqual(new Set(rows.map(r=>r.key)),new Set(['work:late','work:stage','work:owner','post:review','editorial:q1']));
 assert.equal(rows.find(r=>r.key==='editorial:q1').href,'/content#post-q1');
});
test('only saved missing launch requirements appear, and opening day never invents a time',()=>{
 const s=source([{kind:'plan',id:'launch',data:{launchDate:'2026-03-10',address:''}}]);
 assert.equal(overviewAttention(s,null,now)[0].reason,'Confirm the store address');
 assert.equal(overviewAgenda(s,'2026-03-08','2026-03-14')[0].date,'2026-03-10');
});
test('active campaign stages include exactly five positions with missing stages explicit',()=>{
 const s=source([project('p',{legacyCampaignId:'legacy',type:'weekly_auction'}),work('one',{publishing:false,status:'done',legacyPost:{consignment:{stage:'opening'}}}),work('two',{status:'needs_review',legacyPost:{consignment:{stage:'midweek'}}}),project('draft',{status:'draft'}),project('complete',{status:'completed'})]);
 const cards=overviewCampaigns(s);assert.equal(cards.length,1);assert.equal(cards[0].total,5);assert.equal(cards[0].completed,1);assert.equal(cards[0].stages.length,5);assert.equal(cards[0].stages[2].detail,'Not added');
});
test('legacy stage completion requires all stage posts; missing stages cannot count as complete',()=>{
 const s=source([{kind:'campaign',id:'c',data:{name:'Auction',opening:'2026-03-08T10:00',closing:'2026-03-14T20:00',owner:'maker'}},post('one',{status:'published',consignment:{campaignId:'c',stage:'opening'}}),post('extra',{status:'draft',consignment:{campaignId:'c',stage:'opening'}})]);
 assert.equal(overviewCampaigns(s)[0].completed,0);assert.equal(overviewCampaigns(s)[0].total,5);
});
test('activity uses recorded timestamps, names only known actors, and rejects future or invalid dates',()=>{
 const s=source([project(),work('updated',{updatedAt:'2026-03-08T12:00:00Z'}),work('reviewed',{review:{by:'reviewer',at:'2026-03-08T15:00:00Z',decision:'approve'}}),work('future',{createdAt:'2099-01-01T00:00:00Z',updatedAt:'2099-01-01T00:00:00Z'}),work('bad',{createdAt:'invalid',updatedAt:'invalid'})]);
 const rows=overviewActivity(s,new Map([['owner','Alex'],['reviewer','Jordan']]),now);
 assert.ok(rows.some(r=>r.description==='Jordan approved work'));
 assert.ok(rows.some(r=>r.description==='Task updated'));
 assert.ok(rows.some(r=>r.description==='Alex created campaign'));
 assert.ok(!rows.some(r=>r.title==='future'||r.title==='bad'));
 assert.ok(!rows.some(r=>r.description==='Alex updated task'));
});
test('calendar ranges validate dates and clamp recurring expansion to 93 days',()=>{
 assert.deepEqual(overviewRange('2026-02-30','garbage','2026-03-08'),{from:'2026-03-08',to:'2026-03-08'});
 assert.deepEqual(overviewRange('2026-03-08','2026-03-01','2026-03-08'),{from:'2026-03-08',to:'2026-03-08'});
 assert.equal(overviewRange('2026-03-08','2099-01-01','2026-03-08').to,'2026-06-08');
 assert.equal(calendarHref('2026-03-08'),'/calendar?view=overview&from=2026-03-08&to=2026-03-08');
});
