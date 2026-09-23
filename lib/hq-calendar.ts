import {addDays,scheduleRows} from './hq-operations.ts';
import {projectStatuses,type Deliverable,type HqRecord,type Project} from './hq-model.ts';
import type {CalendarPost} from './content-calendar';
import type {CampaignRecord} from './consignment';
export type CalendarView='month'|'week'|'day';
export function calendarRange(day:string,view:CalendarView) {
  const first=view==='month'?day.slice(0,7)+'-01':day;
  const start=view==='day'?first:addDays(first,-new Date(first+'T12:00:00Z').getUTCDay());
  const count=view==='month'?42:view==='week'?7:1;
  return Array.from({length:count},(_,i)=>addDays(start,i));
}
export function shiftCalendar(day:string,view:CalendarView,direction:number) {
  if(view!=='month') return addDays(day,direction*(view==='week'?7:1));
  const date=new Date(day.slice(0,7)+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+direction);return date.toISOString().slice(0,10);
}
export type CalendarEntry={key:string;title:string;project:string;owner:string;assigned:string[];date:string;status:string;href:string;consignment:boolean;projectData?:Project};
export function calendarEntries(records:HqRecord<Deliverable>[],projects:HqRecord<Project>[],posts:CalendarPost[],campaigns:CampaignRecord[],from:string,to:string):CalendarEntry[] {
 const adopted=new Set(records.map(r=>r.data.legacyPostId));
 const legacy=posts.filter(p=>!adopted.has(p.id));
 const rows=[...scheduleRows(records,projects,'production'),...scheduleRows(records,projects,'publication',legacy,from,to)];
 const projectMap=new Map(projects.map(p=>[p.id,p])),postMap=new Map(legacy.map(p=>[p.id,p])),campaignMap=new Map(campaigns.map(c=>[c.id,c]));
 const entries:CalendarEntry[]=rows.map(r=>{
  const project=projectMap.get(r.projectId),post=postMap.get(r.id),campaign=campaignMap.get(post?.data.consignment?.campaignId||'');
  return {key:r.key,title:r.title+(r.platform?' · '+r.platform:r.kind==='deliverable'?' · Due':''),project:project?.data.title||campaign?.data.name||'Standalone',owner:project?.data.owner||campaign?.data.owner||r.owner,assigned:[...new Set([r.owner,r.publisher,...r.contributors,...(project?.data.members||[])].filter(Boolean))],date:r.date,status:r.stateLabel,href:r.kind==='deliverable'?'/projects/work/'+encodeURIComponent(r.id):'/calendar#legacy-entry-'+encodeURIComponent(r.id),consignment:!!post?.data.consignment||post?.data.category==='Consignment',projectData:project?.data};
 });
 for(const p of projects) for(const [label,date] of [['Event',p.data.eventAt],['Auction opens',p.data.auctionOpensAt],['Auction closes',p.data.auctionClosesAt]]) if(date) entries.push({key:p.id+label,title:p.data.type==='product_release'?'Release':label,project:p.data.title,owner:p.data.owner,assigned:p.data.members,date,status:projectStatuses[p.data.status],href:'/projects/'+encodeURIComponent(p.id),consignment:false,projectData:p.data});
 return entries.filter(e=>e.date&&e.date.slice(0,10)>=from&&e.date.slice(0,10)<=to).sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
}
