import {chicagoWall, stages, type CampaignRecord, type Stage} from './consignment.ts';
import {addDays, instant, nextAction, scheduleRows} from './hq-operations.ts';
import {approvalCurrent, projectMissing, type Deliverable, type HqRecord, type Project, type WorkspaceRecord} from './hq-model.ts';
import type {CalendarPost} from './content-calendar';
import type {Queue} from './content-radar/editorial-model';
import type {VisualStatus} from './hq-presentation';

export type EditorialOverview = {records: {kind: string; id: string; data: unknown}[]};
export type OverviewSources = {
  projects: HqRecord<Project>[]; work: HqRecord<Deliverable>[]; posts: CalendarPost[];
  campaigns: CampaignRecord[]; launch?: {launchDate: string; address: string};
};
export type AgendaItem = {key: string; title: string; date: string; label: string; href: string; owner: string};
export type AttentionItem = AgendaItem & {reason: string; status: VisualStatus; action: string; priority: number};
export const shortStages: Record<Stage, string> = {opening: 'Opening', midweek: 'Midweek', reminder: '48-hour', closing: 'Closing', recap: 'Recap'};
const workHref = (id: string) => '/projects/work/' + encodeURIComponent(id);
const projectHref = (id: string) => '/projects/' + encodeURIComponent(id);
const legacyHref = '/calendar?legacy=1#existing-calendar';
const campaignHref = '/projects#legacy-campaigns';
const isOpen = (p?: Project) => !p || !['completed', 'archived'].includes(p.status);

// Completion requires all intended destinations, including any destination still missing a confirmation.
export function overviewComplete(d: Deliverable) {
  return d.status === 'done' || (d.publishing && d.platforms.length > 0 && d.platforms.every(p => d.publications[p]?.status === 'published'));
}
export function overviewSources(records: WorkspaceRecord[]): OverviewSources {
  const projects = records.filter(r => r.kind === 'project') as HqRecord<Project>[];
  const work = records.filter(r => r.kind === 'deliverable') as HqRecord<Deliverable>[];
  const adoptedPosts = new Set(work.map(r => r.data.legacyPostId));
  const adoptedCampaigns = new Set(projects.map(r => r.data.legacyCampaignId));
  return {
    projects, work,
    posts: (records.filter(r => r.kind === 'post') as CalendarPost[]).filter(r => !adoptedPosts.has(r.id)),
    campaigns: (records.filter(r => r.kind === 'campaign') as CampaignRecord[]).filter(r => !adoptedCampaigns.has(r.id)),
    launch: records.find(r => r.kind === 'plan' && r.id === 'launch')?.data as OverviewSources['launch'],
  };
}
export function calendarHref(from: string, to = from) {
  return '/calendar?' + new URLSearchParams({view: 'overview', from, to});
}
export function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + 'T12:00:00Z')) && new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day;
}
export function overviewRange(from: string, to: string, fallback: string) {
  const start = validDay(from) ? from : fallback;
  const end = validDay(to) && to >= start ? to : start;
  return {from: start, to: end > addDays(start, 92) ? addDays(start, 92) : end};
}
export function greeting(now: number) {
  const hour = Number(chicagoWall(now).slice(11, 13));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

// The Overview and Calendar share this agenda: one post per recorded time, not one count per platform.
// Production deadlines and campaign milestones remain distinct scheduled commitments.
export function overviewAgenda(s: OverviewSources, from: string, to: string): AgendaItem[] {
  const result: AgendaItem[] = [];
  const projects = new Map(s.projects.map(p => [p.id, p.data]));
  const add = (item: AgendaItem) => {
    if (instant(item.date) !== null && item.date.slice(0, 10) >= from && item.date.slice(0, 10) <= to) result.push(item);
  };
  const visible = s.work.filter(r => isOpen(projects.get(r.data.projectId)));
  for (const {id, data: d} of visible) {
    if (!overviewComplete(d) && !['ready', 'done'].includes(d.status)) add({key: id + ':due', title: d.title, date: d.productionDue, label: 'Task due', href: workHref(id), owner: d.owner});
  }
  const groups = new Map<string, AgendaItem>();
  for (const row of scheduleRows(visible, s.projects, 'publication', s.posts.filter(p => p.data.status !== 'archived'), from, to)) {
    const key = row.kind + ':' + row.id + ':' + row.date;
    const label = row.kind === 'legacy' ? 'Calendar post' : row.status === 'published' ? 'Published post' : row.status === 'scheduled' ? 'Scheduled post' : 'Planned post';
    const prior = groups.get(key);
    // Mixed platform states must not imply every platform is published or scheduled.
    groups.set(key, {key, title: row.title, date: row.date, label: prior && prior.label !== label ? 'Publishing activity' : label, href: row.kind === 'legacy' ? legacyHref : workHref(row.id), owner: row.owner});
  }
  groups.forEach(add);
  for (const {id, data: p} of s.projects.filter(p => isOpen(p.data))) {
    const dates = p.type === 'weekly_auction' ? [[p.auctionOpensAt, 'Auction opens'], [p.auctionClosesAt, 'Auction closes']] : [[p.eventAt, p.type === 'product_release' ? 'Release' : 'Event']];
    for (const [date, label] of dates) add({key: 'project:' + id + ':' + label, title: p.title, date, label, href: projectHref(id), owner: p.owner});
  }
  for (const {id, data: c} of s.campaigns) {
    for (const [date, label] of [[c.opening, 'Auction opens'], [c.closing, 'Auction closes']]) add({key: 'campaign:' + id + ':' + label, title: c.name, date, label, href: campaignHref, owner: c.owner});
  }
  if (s.launch && validDay(s.launch.launchDate) && s.launch.launchDate >= from && s.launch.launchDate <= to) {
    result.push({key: 'launch', title: 'Northside launch', date: s.launch.launchDate, label: 'Opening day', href: '/projects#launch', owner: ''});
  }
  return result.toSorted((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export function overviewAttention(s: OverviewSources, editorial: EditorialOverview | null, now: number): AttentionItem[] {
  const items: AttentionItem[] = [];
  const day = chicagoWall(now).slice(0, 10), end = addDays(day, 6);
  const projects = new Map(s.projects.map(p => [p.id, p.data]));
  const overdue = (date: string) => (instant(date) ?? Infinity) < now;
  const due = (date: string) => instant(date) !== null && date.slice(0, 10) <= end;
  for (const {id, data: d} of s.work) {
    const p = projects.get(d.projectId);
    if (!isOpen(p) || overviewComplete(d)) continue;
    const pending = d.platforms.filter(platform => d.publications[platform]?.status !== 'published');
    const pendingDates = pending.map(platform => d.publications[platform]?.status === 'scheduled' ? d.publications[platform].scheduledFor || '' : d.publishAt).filter(date => instant(date) !== null).toSorted();
    const latePublishing = d.publishing && pendingDates.some(overdue);
    const lateProduction = !['ready', 'done'].includes(d.status) && overdue(d.productionDue);
    const stageDue = !!d.legacyPost?.consignment && due(d.publishAt);
    let reason = '', status: VisualStatus = 'attention', priority = 3, action = 'Open Task';
    if (d.blocked) {reason = d.blockedReason || 'Work is blocked'; status = 'blocked'; priority = 0; action = 'Resolve';}
    else if (d.status === 'needs_review') {reason = 'Submitted work is awaiting review'; status = 'in_review'; priority = 1; action = 'Review';}
    else if (lateProduction) {reason = 'Production deadline is overdue'; priority = 1;}
    else if (latePublishing) {reason = 'Publication time passed; confirmation is still needed'; priority = 1; action = 'Check Post';}
    else if (d.status === 'ready' && !approvalCurrent(d, p)) {reason = 'Approval needs renewing after changes'; priority = 2; action = 'Review';}
    else if (!d.owner || (d.publishing && !d.publisher)) {reason = !d.owner ? 'Assign a task owner' : 'Assign a publisher'; action = 'Assign';}
    else if (stageDue) {reason = 'Campaign stage is due this week'; action = 'Open Stage';}
    if (reason) items.push({key: 'work:' + id, title: d.title, reason, status, priority, action, date: latePublishing ? pendingDates[0] : stageDue ? d.publishAt : d.productionDue, owner: d.blocked ? d.blockedBy || d.owner : d.owner, href: workHref(id), label: 'Task'});
  }
  for (const {id, data: p} of s.projects.filter(p => isOpen(p.data))) {
    const missing = projectMissing(p);
    const date = p.type === 'weekly_auction' ? p.auctionClosesAt : p.eventAt;
    const approaching = date && !overdue(date) && due(date);
    if (!s.work.some(d => d.data.projectId === id)) missing.push('Plan campaign tasks');
    if (missing.length || approaching) items.push({key: 'project:' + id, title: p.title, date, owner: p.owner, href: projectHref(id), label: 'Campaign', reason: missing.length ? 'Missing: ' + missing.join(' · ') : p.type === 'weekly_auction' ? 'Auction closes this week' : 'Campaign milestone this week', status: 'attention', priority: approaching ? 2 : 4, action: missing.length ? 'Complete Setup' : 'Open Campaign'});
  }
  for (const {id, data: p} of s.posts) {
    if (p.recurrence || ['published', 'archived'].includes(p.status)) continue;
    const review = p.status === 'review', late = overdue(p.date), stageDue = p.consignment && due(p.date);
    if (review || late || stageDue) items.push({key: 'post:' + id, title: p.title, date: p.date, owner: p.owner || '', href: legacyHref, label: 'Calendar post', reason: review ? 'Calendar post is awaiting review' : late ? 'Post date has passed; check its status' : 'Campaign stage is due this week', status: review ? 'in_review' : 'attention', priority: review || late ? 1 : 3, action: 'Open Calendar'});
  }
  for (const {id, data: c} of s.campaigns) {
    if (!overdue(c.closing) && due(c.closing)) items.push({key: 'campaign:' + id, title: c.name, date: c.closing, owner: c.owner, href: campaignHref, label: 'Auction', reason: 'Auction closes this week', status: 'attention', priority: 2, action: 'Open Campaign'});
  }
  const adopted = new Set(s.work.map(w => w.data.legacyEditorialId));
  for (const row of editorial?.records || []) {
    if (row.kind !== 'queue' || adopted.has(row.id)) continue;
    const q = row.data as Queue;
    if (q.state === 'Needs review') items.push({key: 'editorial:' + row.id, title: q.title, date: q.calendarDate, owner: q.assignee, href: '/content#post-' + encodeURIComponent(row.id), label: 'Post', reason: 'Post is awaiting editorial review', status: 'in_review', priority: 1, action: 'Review Post'});
  }
  if (s.launch && (!validDay(s.launch.launchDate) || !s.launch.address.trim())) items.push({key: 'launch', title: 'Northside launch requirements', date: validDay(s.launch.launchDate) ? s.launch.launchDate : '', owner: '', href: '/projects#launch', label: 'Launch', reason: [!validDay(s.launch.launchDate) && 'Confirm the opening date', !s.launch.address.trim() && 'Confirm the store address'].filter(Boolean).join(' · '), status: 'attention', priority: 4, action: 'Complete Plan'});
  return items.toSorted((a, b) => a.priority - b.priority || (a.date || '9999').localeCompare(b.date || '9999') || a.key.localeCompare(b.key));
}

export type CampaignCard = {id: string; title: string; href: string; owner: string; status: VisualStatus; label: string; opening: string; closing: string; dateLabel: string; completed: number; total: number; unit: string; next: string; stages?: {stage: Stage; state: 'complete' | 'in_progress' | 'not_started'; detail: string}[]};
export function overviewCampaigns(s: OverviewSources): CampaignCard[] {
  const cards: CampaignCard[] = s.projects.filter(p => p.data.status === 'active').map(({id, data: p}) => {
    const work = s.work.filter(d => d.data.projectId === id);
    const open = work.filter(d => !overviewComplete(d.data)).toSorted((a, b) => (a.data.productionDue || '9999').localeCompare(b.data.productionDue || '9999'));
    const missing = projectMissing(p);
    const consignment = !!p.legacyCampaignId || work.some(d => !!d.data.legacyPost?.consignment);
    const progress = consignment ? stages.map(stage => {
      const entries = work.filter(d => d.data.legacyPost?.consignment?.stage === stage);
      const done = entries.length > 0 && entries.every(d => overviewComplete(d.data));
      return {stage, state: done ? 'complete' as const : entries.some(d => d.data.status !== 'to_do') ? 'in_progress' as const : 'not_started' as const, detail: done ? 'Complete' : !entries.length ? 'Not added' : entries.every(d => d.data.status === 'to_do') ? 'Not started' : 'In progress'};
    }) : undefined;
    return {id, title: p.title, href: projectHref(id), owner: p.owner, status: missing.length || !work.length || progress?.some(s => s.detail === 'Not added') || open.some(d => d.data.blocked) ? 'attention' : 'on_track', label: 'Active', opening: p.type === 'weekly_auction' ? p.auctionOpensAt : p.eventAt, closing: p.auctionClosesAt, dateLabel: p.type === 'weekly_auction' ? 'Opens' : p.type === 'product_release' ? 'Release' : 'Event', completed: progress ? progress.filter(p => p.state === 'complete').length : work.filter(d => overviewComplete(d.data)).length, total: progress ? 5 : work.length, unit: progress ? 'stages' : 'tasks', next: missing.length ? 'Complete setup: ' + missing[0] : open.length ? open[0].data.title + ' · ' + nextAction(open[0].data, p) : progress?.some(s => s.detail === 'Not added') ? 'Add missing campaign stages' : work.length ? 'Review and close campaign' : 'Add the first task', stages: progress};
  });
  for (const {id, data: c} of s.campaigns) {
    const posts = s.posts.filter(p => p.data.consignment?.campaignId === id);
    const progress = stages.map(stage => {
      const entries = posts.filter(p => p.data.consignment?.stage === stage);
      const done = entries.length > 0 && entries.every(p => p.data.status === 'published');
      return {stage, state: done ? 'complete' as const : entries.some(p => p.data.status !== 'draft') ? 'in_progress' as const : 'not_started' as const, detail: done ? 'Published in calendar' : !entries.length ? 'Not added' : entries.every(p => p.data.status === 'draft') ? 'Not started' : 'In progress'};
    });
    if (progress.every(p => p.state === 'complete')) continue;
    cards.push({id: 'legacy:' + id, title: c.name, href: campaignHref, owner: c.owner, status: posts.some(p => p.data.status === 'review') ? 'in_review' : progress.some(p => p.state !== 'not_started') ? 'on_track' : 'not_started', label: 'Calendar campaign', opening: c.opening, closing: c.closing, dateLabel: 'Opens', completed: progress.filter(p => p.state === 'complete').length, total: 5, unit: 'stages', next: progress.find(p => p.state !== 'complete')?.detail === 'Not added' ? 'Add missing campaign stages' : 'Review ' + shortStages[progress.find(p => p.state !== 'complete')!.stage].toLowerCase() + ' stage', stages: progress});
  }
  return cards.toSorted((a, b) => (a.closing || a.opening || '9999').localeCompare(b.closing || b.opening || '9999'));
}

export type ActivityItem = {key: string; title: string; description: string; at: string; href: string};
export function overviewActivity(s: OverviewSources, names: Map<string, string>, now: number) {
  const items: ActivityItem[] = [];
  const add = (item: ActivityItem) => {const time = Date.parse(item.at); if (Number.isFinite(time) && time <= now && /(?:Z|[+-]\d{2}:\d{2})$/.test(item.at)) items.push(item);};
  for (const record of [...s.projects.map(r => ({...r, kind: 'Campaign', href: projectHref(r.id)})), ...s.work.map(r => ({...r, kind: 'Task', href: workHref(r.id)}))]) {
    const d = record.data;
    add({key: record.kind + ':' + record.id, title: d.title, description: d.updatedAt && d.updatedAt !== d.createdAt ? record.kind + ' updated' : (names.get(d.createdBy) ? names.get(d.createdBy) + ' created ' + record.kind.toLowerCase() : record.kind + ' created'), at: d.updatedAt || d.createdAt, href: record.href});
  }
  for (const {id, data: d} of s.work) if (d.review) add({key: 'review:' + id, title: d.title, description: (names.get(d.review.by) || 'Reviewer') + (d.review.decision === 'approve' ? ' approved work' : ' requested changes'), at: d.review.at, href: workHref(id)});
  return items.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key)).slice(0, 5);
}
