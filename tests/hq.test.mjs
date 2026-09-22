import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hqSections, legacyDestination, pageForPath, sectionForPath, workspacePath} from '../lib/hq-navigation.ts';
import {todayWork} from '../lib/hq-today.ts';

test('bookmarked Hub tabs resolve to the reused tools; unknown fragments stay internal', () => {
  for (const [hash, path] of Object.entries({launch:'/projects#launch',studio:'/assets',calendar:'/calendar',tracking:'/projects#tracking',performance:'/results',roadmap:'/settings'})) {
    assert.equal(legacyDestination('#' + hash), path);
  }
  assert.equal(legacyDestination('#https://example.test'), '/today');
  assert.equal(legacyDestination('#constructor'), '/today');
  assert.equal(legacyDestination(''), '/today');
  assert.equal(sectionForPath('/assets/research'), 'assets');
  assert.equal(sectionForPath('/calendar'), 'calendar');
});

test('Today uses Chicago midnight and distinguishes templates, published work and overdue drafts', () => {
  const post = (id, date, status='draft', extra={}) => ({id,data:{title:id,date,status,source:'instagram',caption:'',...extra}});
  const posts = [post('previous','2026-09-18T12:00'),post('today','2026-09-19T09:00'),post('review','2026-09-18T16:00','review'),post('ready','2026-09-18T16:00','approved'),post('future','2026-09-20T16:00','approved'),post('published','2026-09-18T16:00','published'),post('template','2026-09-15T09:00','draft',{recurrence:'weekly-tuesday'})];
  const before = todayWork(posts, Date.parse('2026-09-19T04:59:00Z'));
  assert.equal(before.day, '2026-09-18');
  assert.equal(before.scheduled.length, 4);
  const after = todayWork(posts, Date.parse('2026-09-19T05:00:00Z'));
  assert.equal(after.day, '2026-09-19');
  assert.deepEqual(after.scheduled.map(p=>p.id), ['today']);
  assert.deepEqual(after.overdue.map(p=>p.id), ['previous','review']);
  assert.deepEqual(after.ready.map(p=>p.id), ['ready']);
  assert.deepEqual(after.review.map(p=>p.id), ['review']);
  assert.equal(todayWork([], Date.parse('2026-11-01T06:30:00Z')).day, '2026-11-01');
  assert.equal(todayWork([], Date.parse('2026-11-01T07:30:00Z')).day, '2026-11-01');
  assert.equal(posts[0].id, 'previous', 'reading Today must not reorder the source records');
});


test('navigation keeps core workflows distinct and preserves record detail locations', () => {
  assert.deepEqual(hqSections.filter(s=>s.group==='primary').map(s=>s.label), ['Overview','Work','Calendar','Campaigns','Content','Results']);
  assert.deepEqual(hqSections.filter(s=>s.group==='secondary').map(s=>s.label), ['Assets','Team','Settings']);
  assert.equal(sectionForPath('/projects/work/example'), 'work');
  assert.equal(sectionForPath('/projects/example'), 'campaigns');
  assert.equal(sectionForPath('/requests/example'), 'work');
  assert.equal(pageForPath('/assets/research').breadcrumb.href, '/assets');
  assert.equal(pageForPath('/projects/work/example').breadcrumb.href, '/work');
  for (const s of hqSections) assert.equal(workspacePath(s.href), true);
  assert.equal(workspacePath('/requests/example'), true);
  assert.equal(workspacePath('/login'), false);
});
