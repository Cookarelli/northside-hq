import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hqSections,sectionForPath,hasWorkspaceHeader,relocatedHref} from '../lib/hq-navigation.ts';
import {tabHref,selectedTab,assignmentTabs} from '../lib/hq-tabs.ts';
import {authLandingDestination} from '../lib/auth-landing.ts';
import {auctionDb} from './helpers/auction-db.mjs';

test('four primary destinations retain Home and Settings context on nested and legacy routes',()=>{
 assert.deepEqual(hqSections.map(s=>s.label),['Home','Calendar','Projects','Assets']);
 for(const path of ['/requests','/requests/request-123','/assignments'])assert.equal(sectionForPath(path),'today');
 for(const path of ['/settings','/settings/staff','/operations'])assert.equal(sectionForPath(path),'settings');
 for(const path of ['/requests/request-123','/settings','/operations','/assignments'])assert.ok(hasWorkspaceHeader(path));
 for(const path of ['/login','/agreements/required','/settings-other','/requests-other'])assert.equal(hasWorkspaceHeader(path),false);
});

test('relocated bookmarks retain assignment selection, repeated filters, encoded values and record anchors',()=>{
 for(const tab of ['active','completed','projects']) {
  const url=new URL(relocatedHref('assignments',`tab=${tab}&owner=jon&owner=brody&search=Store+%26+photos`,'#deliverable-opening-child'),'https://example.test');
  assert.equal(url.pathname,'/today');assert.equal(url.searchParams.get('tab'),'my-work');assert.equal(url.searchParams.get('assignment'),tab);
  assert.deepEqual(url.searchParams.getAll('owner'),['jon','brody']);assert.equal(url.searchParams.get('search'),'Store & photos');assert.equal(url.hash,'#deliverable-opening-child');
 }
 assert.equal(relocatedHref('settings','view=permissions&staffId=jon','#staff-jon'),'/settings?staffId=jon&tab=permissions#staff-jon');
 assert.equal(relocatedHref('staff','view=staff&search=Jon','#staff-jon'),'/settings?search=Jon&tab=staff#staff-jon');
 assert.equal(relocatedHref('permissions','tab=permissions&staffId=joey'),'/settings?tab=permissions&staffId=joey');
 assert.equal(relocatedHref('settings',''),'/settings');
});

test('Home assignment filters do not select the team project view or overwrite other query state',()=>{
 const href=tabHref('/today','tab=my-work&owner=jon','projects','assignment');
 assert.equal(href,'/today?tab=my-work&owner=jon&assignment=projects');
 const params=new URL(href,'https://example.test').searchParams;
 assert.equal(params.get('tab'),'my-work');assert.equal(selectedTab(assignmentTabs,params.get('assignment'),'active'),'projects');
});

test('known legacy landing bookmarks reach their relocated area without entering password recovery',async()=>{
 for(const [hash,path] of [['operations','/settings'],['staff','/settings?tab=staff'],['permissions','/settings?tab=permissions'],['assignments','/today?tab=my-work'],['requests','/requests']]) {
  let cleared=false;
  const destination=await authLandingDestination('https://example.test/#'+hash,()=>{cleared=true;},()=>assert.fail('not a recovery link'));
  assert.equal(destination,path+'#'+hash);assert.ok(cleared);
 }
 assert.equal(await authLandingDestination('https://example.test/?staffId=jon#permissions',()=>{},()=>assert.fail('not a recovery link')),'/settings?staffId=jon&tab=permissions#permissions');
});

test('Settings keeps staff directory reads and enforces access/permission writes in the database',async()=>{
 const f=await auctionDb();
 try {
  await f.db.exec("reset role;update private.staff_access set role='admin' where id='joey'");
  const team=async()=>(await f.db.query('select hub_team() result')).rows[0].result;
  const save=async(row,data)=>(await f.db.query('select hub_editorial_save($1,$2,$3,$4::jsonb)',['team',row.id,row.version,JSON.stringify(data)])).rows;
  await f.actor('jon');const staff=(await team()).find(s=>s.id==='jon');assert.ok(staff);assert.equal((await f.hq('context')).admin,false);
  await assert.rejects(save(staff,{...staff.data,role:'admin'}),/Only administrators/);
  await assert.rejects(f.hq('permission',{staffId:'jon',capability:'coordinate_requests',enabled:true}),/Only workspace administrators/);
  for(const admin of ['steve','joey']) {
   await f.actor(admin);assert.equal((await f.hq('context')).admin,true);
   await f.hq('permission',{staffId:'jon',capability:'coordinate_requests',enabled:admin==='steve'});
   const current=(await team()).find(s=>s.id==='jon');await save(current,{...current.data,title:'Team member'});
  }
  await f.actor('jon');assert.equal((await f.hq('context')).canCoordinate,false);
  await f.db.exec("reset role;update private.staff_access set active=false where id='jon'");await f.actor('jon');
  await assert.rejects(team(),/Staff access required/);
 } finally {await f.db.close();}
});
