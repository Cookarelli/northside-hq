import {auctionFacts, invalidateApproval} from './consignment-review.ts';
import type {CalendarPost, CalendarPostData} from './content-calendar';

export const stages = ['opening', 'midweek', 'reminder', 'closing', 'recap'] as const;
export type Stage = typeof stages[number];
export const stageNames: Record<Stage, string> = {opening: 'When listings open', midweek: 'Middle of the week', reminder: '48 hours before closing', closing: 'Closing day', recap: 'After closing'};
export type ConsignmentMeta = {campaignId: string; stage: Stage; slot: string};
export type Campaign = {
  name: string; opening: string; closing: string; midweek: string; recap: string;
  auctionPlatform: string; batchUrl: string; cards: {name: string; url: string}[];
  owner: string; platforms: string[]; testPlatform: '' | 'youtube' | 'tiktok' | 'snapchat';
};
export type CampaignRecord = {id: string; data: Campaign};
export type CampaignSave = {id: string; mutationId: string; campaign: Campaign; posts: CalendarPost[]; base: {campaign: Campaign | null; posts: CalendarPost[]}};
export function chicagoWall(instant: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(instant);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Legacy imports can carry an explicit offset; native schedule inputs need Chicago wall time.
export function scheduleWall(value: string) {
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const instant=Date.parse(value);
    if(Number.isFinite(instant))return chicagoWall(instant);
  }
  return value;
}
// Chicago uses UTC-5/UTC-6. Round-trip both candidates: never silently normalize a DST gap/fold.
export function chicagoInstant(wall: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) throw new Error('Choose a complete Chicago date and time.');
  const nominal = Date.parse(wall + ':00Z');
  const matches = [5, 6].map(h => nominal + h * 3600000).filter(n => Number.isFinite(n) && chicagoWall(n) === wall);
  if (matches.length !== 1) throw new Error(`${wall}: this Chicago time is missing or occurs twice during daylight saving. Choose an unambiguous time.`);
  return matches[0];
}
export function stageDates(c: Campaign): Record<Stage, string> {
  const opening = chicagoInstant(c.opening), closing = chicagoInstant(c.closing);
  if (closing <= opening) throw new Error('Auction closing must follow listings opening.');
  const midweek = chicagoInstant(c.midweek), recap = chicagoInstant(c.recap);
  if (midweek < opening || midweek >= closing) throw new Error('Choose a midweek posting time during the auction.');
  if (recap <= closing) throw new Error('Choose a recap posting time after closing.');
  const reminder = chicagoWall(closing - 48 * 3600000);
  chicagoInstant(reminder);
  return {opening: c.opening, midweek: c.midweek, reminder, closing: c.closing, recap: c.recap};
}
const tasks: Record<Stage, string[]> = {
  opening: ['Verify live listings and all direct lot links', 'Produce batch preview and featured card carousel'],
  midweek: ['Produce individual card spotlights', 'Collect staff favorites', 'Prepare selected new-platform test, if any'],
  reminder: ['Select strongest cards', 'Create 48-hour reminder creative', 'Verify auction closing time'],
  closing: ['Verify closing times against the auction platform', 'Build Stories with direct lot links'],
  recap: ['Verify final results before writing any claims', 'Prepare results recap', 'Invite future consignment submissions'],
};
export function generateCampaign(id: string, c: Campaign): CalendarPost[] {
  const dates = stageDates(c);
  return stages.map(stage => ({id: `consignment_${id}_${stage}`, data: {
    title: `${c.name} — ${stageNames[stage]}`, date: dates[stage], timezone: 'America/Chicago',
    source: c.platforms[0], platforms: stage === 'midweek' && c.testPlatform ? [...new Set([...c.platforms, c.testPlatform])] : c.platforms,
    caption: ({opening: `Explore ${c.name}: featured cards and direct auction links below.`, midweek: `Staff favorites from ${c.name}. Explore each featured lot below.`, reminder: `48 hours until ${c.name} closes. Explore the featured cards below.`, closing: `${c.name} closes today. [Verify and insert exact closing times before publishing.]`, recap: `[Insert verified results for ${c.name}.] Have cards for a future auction? Submit your consignments.`})[stage],
    category: 'Consignment', status: 'draft', owner: c.owner, tasks: [...tasks[stage], ...(stage === 'opening' || stage === 'midweek' ? c.cards.map(card => `Feature ${card.name}: ${card.url}`) : []), ...(stage === 'midweek' && c.testPlatform ? [`Create one ${c.testPlatform} test and record what the team learns`] : [])], assets: [],
    references: [c.batchUrl, ...c.cards.map(card => card.url)], consignment: {campaignId: id, stage, slot: stage},
  }}));
}
// Shift dates by the change to each stage's anchor, retaining every staff-authored field and extra spotlight.
export function rescheduleCampaign(before: Campaign, after: Campaign, posts: CalendarPost[]): CalendarPost[] {
  const oldDates = stageDates(before), newDates = stageDates(after);
  return posts.map(post => {
    if (!post.data.consignment) return post;
    const stage = post.data.consignment.stage;
    if (post.data.status === 'published') return post;
    const date = chicagoWall(chicagoInstant(post.data.date) + chicagoInstant(newDates[stage]) - chicagoInstant(oldDates[stage]));
    chicagoInstant(date);
    const changedFacts = JSON.stringify(auctionFacts(before)) !== JSON.stringify(auctionFacts(after));
    const data = changedFacts && ['closing','recap'].includes(stage) ? invalidateApproval(post.data) : post.data;
    return {...post, data: {...data, date}};
  });
}
export function scheduleWarnings(proposed: CalendarPost[], existing: CalendarPost[], campaign: Campaign): string[] {
  const messages = new Set<string>(), ids = new Set(proposed.map(p => p.id));
  const other = existing.filter(p => !ids.has(p.id));
  for (const post of proposed) {
    const p = post.data, day = p.date.slice(0, 10);
    const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
    const onDay = [...other, ...proposed].filter(x => x.data.recurrence ? weekday === 2 && x.data.date.slice(0, 10) <= day : x.data.date.slice(0, 10) === day);
    if (onDay.length > 3) messages.add(`${day}: ${onDay.length} posts exceed the three-post target (including Tuesday series).`);
    if (onDay.some(x => x.id !== post.id && x.data.date.slice(11, 16) === p.date.slice(11, 16))) messages.add(`${p.date.replace('T', ' ')} CT: posting-time collision for ${p.title}.`);
    if (p.consignment?.stage === 'reminder' && chicagoInstant(p.date) < chicagoInstant(campaign.opening)) messages.add(`${p.title}: reminder is before listings open.`);
    if (p.consignment?.stage === 'reminder' && chicagoInstant(p.date) !== chicagoInstant(campaign.closing) - 48 * 3600000) messages.add(`${p.title}: adjusted reminder is no longer exactly 48 hours before closing; revise the caption.`);
    if (p.consignment?.stage === 'recap' && p.date <= campaign.closing) messages.add(`${p.title}: recap must follow closing.`);
  }
  return [...messages];
}
export function updateProduction(data: CalendarPostData, field: 'tasks' | 'assets' | 'references' | 'platforms', text: string): CalendarPostData {
  return {...data, [field]: text.split('\n')};
}
