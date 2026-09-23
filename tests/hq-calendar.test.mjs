import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarRange,shiftCalendar,calendarEntries} from '../lib/hq-calendar.ts';
import {ownerColor,ownerColors,projectColor} from '../lib/owner-colors.ts';
import {blankProject,blankDeliverable} from '../lib/hq-model.ts';

test('calendar ranges and navigation survive month, year, leap-day and DST boundaries',()=>{
 assert.equal(shiftCalendar('2026-01-31','month',1),'2026-02-01');
 assert.equal(shiftCalendar('2026-12-15','month',1),'2027-01-01');
 assert.equal(shiftCalendar('2026-03-08','day',1),'2026-03-09');
 assert.deepEqual(calendarRange('2026-03-08','week'),['2026-03-08','2026-03-09','2026-03-10','2026-03-11','2026-03-12','2026-03-13','2026-03-14']);
 assert.equal(calendarRange('2028-02-15','month').length,42);
 assert.ok(calendarRange('2028-02-15','month').includes('2028-02-29'));
 assert.deepEqual(calendarRange('2026-09-23','day'),['2026-09-23']);
});
test('owner mapping distinguishes Nik/Nick, maps the existing roster and prioritizes consignment',()=>{
 assert.equal(ownerColor('nik').label,'Nik');assert.equal(ownerColor('nick').label,'Nick');
 assert.equal(ownerColor('uuid','Nick Smith').label,'Nick');
 assert.equal(ownerColor('joey').label,'CEO');assert.equal(ownerColor('brody').label,'Consignment');
 assert.equal(ownerColor('nik','Nik',true).label,'Consignment');
 assert.equal(projectColor({...blankProject,owner:'nick',legacyCampaignId:'c'},id=>id).label,'Consignment');
 assert.equal(projectColor({...blankProject,owner:'nik',members:['nick']},id=>id).label,'Nik');
 assert.equal(ownerColor('unknown').label,'Other / unassigned');
});
test('all owner label color pairs meet WCAG AA normal text contrast',()=>{
 const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
 for(const c of Object.values(ownerColors)) assert.ok((luminance(c.background)+.05)/(luminance(c.text)+.05)>=4.5,c.label);
});
test('calendar preserves source records, parent ownership, scheduled times, legacy recurrences and deep links',()=>{
 const projects=[{id:'p',data:{...blankProject,title:'Launch',owner:'nick',members:['zach'],status:'active',eventAt:'2026-09-24T12:00'}}];
 const records=[{id:'d',data:{...blankDeliverable,title:'Announcement',owner:'nik',contributors:['jon'],projectId:'p',status:'to_do',productionDue:'2026-09-23T10:00',publishAt:'2026-09-23T11:00',platforms:['facebook'],publications:{facebook:{status:'scheduled',scheduledFor:'2026-09-25T12:00'}},legacyPostId:'adopted'}}];
 const posts=[{id:'series',data:{title:'Weekly',date:'2026-09-01T09:00',source:'facebook',recurrence:'weekly-tuesday',status:'draft'}},{id:'adopted',data:{title:'Old copy',date:'2026-09-23T10:00',source:'facebook',status:'draft'}}];
 const before=JSON.stringify({records,projects,posts});
 const entries=calendarEntries(records,projects,posts,[],'2026-09-01','2026-09-30');
 assert.equal(entries.filter(e=>e.title==='Weekly · facebook').length,5);
 assert.equal(entries.filter(e=>e.title.includes('Old copy')).length,0);
 const due=entries.find(e=>e.key==='d:production');assert.equal(due.owner,'nick');assert.equal(due.href,'/projects/work/d');assert.ok(due.assigned.includes('jon'));assert.ok(due.assigned.includes('zach'));
 assert.equal(entries.find(e=>e.key==='d:facebook').date,'2026-09-25T12:00');
 assert.equal(entries.find(e=>e.key==='pEvent').href,'/projects/p');
 assert.equal(entries.find(e=>e.title==='Weekly · facebook').href,'/calendar#legacy-entry-series');
 assert.equal(JSON.stringify({records,projects,posts}),before);
});
