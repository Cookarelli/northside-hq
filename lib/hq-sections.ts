import {chicagoWall, stages, type Stage} from './consignment.ts';
import {addDays, instant, nextAction} from './hq-operations.ts';
import {overviewComplete, type AgendaItem, type OverviewSources} from './hq-overview.ts';
import {projectMissing, type Deliverable, type HqRecord, type Project} from './hq-model.ts';

export const taskViews = ['My Tasks', 'Due Today', 'Upcoming', 'Overdue', 'Completed', 'All Tasks'] as const;
export type TaskView = typeof taskViews[number];
export function taskDeadline(d: Deliverable) {
  if (d.status !== 'ready' || !d.publishing) return d.productionDue;
  return d.platforms.filter(p => d.publications[p]?.status !== 'published').map(p => d.publications[p]?.status === 'scheduled' ? d.publications[p].scheduledFor || '' : d.publishAt).filter(Boolean).toSorted()[0] || '';
}
export function taskGroups(records: HqRecord<Deliverable>[], projects: HqRecord<Project>[], staffId: string, now: number): Record<TaskView, HqRecord<Deliverable>[]> {
  const day = chicagoWall(now).slice(0, 10), parents = new Map(projects.map(p => [p.id, p.data]));
  const active = records.filter(r => !['completed', 'archived'].includes(parents.get(r.data.projectId)?.status || '') && !overviewComplete(r.data));
  const sorted = active.toSorted((a,b) => (taskDeadline(a.data) || '9999').localeCompare(taskDeadline(b.data) || '9999'));
  return {
    'All Tasks': records.toSorted((a,b)=>(taskDeadline(a.data)||'9999').localeCompare(taskDeadline(b.data)||'9999')),
    'My Tasks': sorted.filter(r => [r.data.owner, r.data.publisher, ...r.data.contributors].includes(staffId)),
    'Due Today': sorted.filter(r => instant(taskDeadline(r.data)) !== null && taskDeadline(r.data).slice(0,10) === day),
    'Upcoming': sorted.filter(r => instant(taskDeadline(r.data)) !== null && taskDeadline(r.data).slice(0,10) > day),
    'Overdue': sorted.filter(r => (instant(taskDeadline(r.data)) ?? Infinity) < now),
    'Completed': records.filter(r => overviewComplete(r.data)).toSorted((a,b) => (b.data.updatedAt || '').localeCompare(a.data.updatedAt || '')),
  };
}
export function campaignLifecycle(p: Project, records: HqRecord<Deliverable>[]) {
  const work = records; // Caller supplies this campaign's tasks.
  if (!p.legacyCampaignId && !work.some(d => d.data.legacyPost?.consignment)) return null;
  const result = stages.map(stage => {
    const items = work.filter(d => d.data.legacyPost?.consignment?.stage === stage);
    return {stage, complete: items.length > 0 && items.every(d => overviewComplete(d.data)), missing: !items.length};
  });
  const current = result.findIndex(s => !s.complete);
  return result.map((s,i) => ({...s, state: s.complete ? 'complete' as const : i === current ? 'current' as const : 'upcoming' as const}));
}
export const lifecycleNames: Record<Stage,string> = {opening:'Open',midweek:'Midweek',reminder:'48 Hours',closing:'Closing Day',recap:'Results'};
export function campaignNext(p: Project, records: HqRecord<Deliverable>[]) {
  if (p.status === 'completed') return {text:'Campaign complete. Review the recorded results.', workId:''};
  if (p.status === 'archived') return {text:'Archived campaign. Its records remain available.', workId:''};
  const missing = projectMissing(p);
  if (missing.length) return {text:'Complete setup: '+missing[0], workId:''};
  if (p.status === 'draft') return {text:'Review the brief and activate this campaign.', workId:''};
  const open = records.filter(r => !overviewComplete(r.data)).toSorted((a,b) => Number(b.data.blocked)-Number(a.data.blocked) || Number(b.data.status==='needs_review')-Number(a.data.status==='needs_review') || (taskDeadline(a.data)||'9999').localeCompare(taskDeadline(b.data)||'9999'));
  if (open.length) return {text:open[0].data.title+' · '+nextAction(open[0].data,p),workId:open[0].id};
  return {text:records.length?'Review the campaign and mark it complete.':'Add the first task to plan this campaign.',workId:''};
}
export function calendarWindow(anchor: string, view: 'week'|'month') {
  const date = new Date(anchor+'T12:00:00Z');
  if (view === 'week') {const from=addDays(anchor,-((date.getUTCDay()+6)%7));return {from,to:addDays(from,6)};}
  const from=anchor.slice(0,7)+'-01', last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0,12));
  return {from,to:from.slice(0,8)+String(last.getUTCDate()).padStart(2,'0')};
}
export function moveCalendar(anchor: string, view: 'week'|'month', direction: number) {
  if(view==='week')return addDays(anchor,direction*7);
  const d=new Date(anchor+'T12:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+direction);return d.toISOString().slice(0,10);
}
export type AgendaCategory = 'Content'|'Auction'|'Release'|'Event'|'Operations';
export function agendaCategory(item: AgendaItem, sources: OverviewSources): AgendaCategory {
  if (item.label.includes('Auction') || item.key.startsWith('campaign:')) return 'Auction';
  if (item.label==='Release')return 'Release';
  if (item.label==='Event')return 'Event';
  if (item.label==='Task due'||item.key==='launch')return 'Operations';
  const post=sources.posts.find(p=>item.key.startsWith('legacy:'+p.id+':'));
  const work=sources.work.find(w=>item.key.startsWith('deliverable:'+w.id+':'));
  if(post?.data.consignment || work?.data.legacyPost?.consignment)return 'Auction';
  return 'Content';
}
export type MetricRow = {date:string;source:string;campaign:string;[key:string]:string|number};
export function reportingSources(rows: MetricRow[]) {
  const result=new Map<string,{source:string;spend:number;revenue:number;orders:number;leads:number}>();
  for(const row of rows){const item=result.get(row.source)||{source:row.source,spend:0,revenue:0,orders:0,leads:0};item.spend+=Number(row.spend)||0;item.revenue+=(Number(row.onlineRevenue)||0)+(Number(row.posRevenue)||0);item.orders+=(Number(row.onlineOrders)||0)+(Number(row.posOrders)||0);item.leads+=Number(row.leads)||0;result.set(row.source,item);}
  return [...result.values()].toSorted((a,b)=>b.revenue-a.revenue||a.source.localeCompare(b.source));
}
