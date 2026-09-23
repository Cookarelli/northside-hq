import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import nextTesting from 'next/experimental/testing/server.js';
const {unstable_doesMiddlewareMatch}=nextTesting;
import {chicagoDay} from '../lib/content-radar/dates.ts';

test('research date display uses Chicago midnight, preserves date-only values, and handles invalid input',()=>{
 assert.equal(chicagoDay('2026-09-24T04:59:00Z'),'Sep 23, 2026');
 assert.equal(chicagoDay('2026-09-24T05:00:00Z'),'Sep 24, 2026');
 assert.equal(chicagoDay('2026-01-24T05:59:00Z'),'Jan 23, 2026');
 assert.equal(chicagoDay('2026-01-24T06:00:00Z'),'Jan 24, 2026');
 assert.equal(chicagoDay('2026-09-24'),'Sep 24, 2026');
 assert.equal(chicagoDay('not-a-date'),'Not supplied');
 assert.equal(chicagoDay(null),'Not supplied');
});

test('all primary HQ routes refresh sessions, including direct My Assignments visits',async()=>{
 const source=await readFile(new URL('../proxy.ts',import.meta.url),'utf8');
 const match=source.match(/export const config=(\{matcher:.*\});/);
 assert.ok(match);
 const config=Function('return ('+match[1]+')')();
 for(const url of ['/today','/assignments','/projects','/projects/example','/projects/work/example','/calendar','/requests','/assets','/agreements/required'])
  assert.equal(unstable_doesMiddlewareMatch({config,nextConfig:{},url}),true,url);
 assert.equal(unstable_doesMiddlewareMatch({config,nextConfig:{},url:'/_next/static/example.js'}),false);
});

test('legacy offset schedules remain editable and render on the correct Chicago calendar day without changing saved records',async()=>{
 const {blankProject,blankDeliverable,projectDraft,deliverableDraft,projectInput,deliverableInput}=await import('../lib/hq-model.ts');
 const {calendarEntries}=await import('../lib/hq-calendar.ts');
 const {calendarTime,calendarDay}=await import('../lib/content-calendar.ts');
 const {instant}=await import('../lib/hq-operations.ts');
 const project={id:'legacy',data:{...blankProject,title:'Legacy campaign',owner:'steve',auctionClosesAt:'2026-09-27T21:00:00-05:00'}};
 const deliverable={id:'legacy-work',data:{...blankDeliverable,title:'Legacy reminder',projectId:'legacy',publishAt:'2026-09-26T21:00:00-05:00',productionDue:'2026-09-24T01:00:00Z',publications:{}}};
 const saved=JSON.stringify({project,deliverable});
 assert.equal(projectDraft(project.data).auctionClosesAt,'2026-09-27T21:00');
 assert.equal(deliverableDraft(deliverable.data).publishAt,'2026-09-26T21:00');
 assert.equal(projectInput.safeParse(projectDraft(project.data)).success,true);
 assert.equal(deliverableInput.safeParse(deliverableDraft(deliverable.data)).success,true);
 assert.equal(calendarTime(deliverable.data.productionDue),'8:00 p.m. CT');
 assert.match(calendarDay(deliverable.data.productionDue),/Sep 23/);
 const entries=calendarEntries([deliverable],[project],[],[],'2026-09-23','2026-09-23');
 assert.equal(entries.length,1);
 assert.equal(entries[0].date,'2026-09-23T20:00');
 assert.equal(instant('2026-09-26T21:00:00-05:00'),Date.parse('2026-09-27T02:00:00Z'));
 assert.equal(JSON.stringify({project,deliverable}),saved);
});
