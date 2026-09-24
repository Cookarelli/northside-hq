import {scheduleWall} from './consignment.ts';
import {auctionCalendarTitle,deliverableHref,reminderDue} from './auction-campaigns.ts';
import {auctionStatus,auctionStatuses} from './auction-deliverables.ts';
import {workStatus} from './project-tasks.ts';
import {STORE_OPEN_CHECKLIST,STORE_OPEN_CHECKLIST_HREF,STORE_OPENING_WALL,STORE_OPENING_TITLE} from './store-opening.ts';
import {addDays,finished,scheduleRows} from './hq-operations.ts';
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
export type CalendarEntry={milestone?:'store-opening';checklist?:boolean;complete?:boolean;key:string;title:string;project:string;campaign?:string;deliverableOwnerColor?:boolean;owner:string;assigned:string[];date:string;dateOnly?:boolean;endAt?:string;status:string;href:string;consignment:boolean;projectData?:Project};
export function calendarEntries(records:HqRecord<Deliverable>[],projects:HqRecord<Project>[],posts:CalendarPost[],campaigns:CampaignRecord[],from:string,to:string):CalendarEntry[] {
 const adopted=new Set(records.map(r=>r.data.legacyPostId));
 const legacy=posts.filter(p=>!adopted.has(p.id));
 const rows=[...scheduleRows(records,projects,'production'),...scheduleRows(records,projects,'publication',legacy,from,to)];
 const recordMap=new Map(records.map(r=>[r.id,r]));
 const projectMap=new Map(projects.map(p=>[p.id,p])),postMap=new Map(legacy.map(p=>[p.id,p])),campaignMap=new Map(campaigns.map(c=>[c.id,c]));
 const reminders=records.filter(r=>!r.data.deletedAt&&!!r.data.campaignReference&&[48,24,2].includes(r.data.reminderHours||0));
 const reminderIds=new Set(reminders.map(r=>r.id));
 const entries:CalendarEntry[]=rows.filter(r=>r.kind!=='deliverable'||!reminderIds.has(r.id)).map(r=>{
  const source=r.kind==='deliverable'?recordMap.get(r.id)?.data:undefined,project=projectMap.get(r.projectId),post=postMap.get(r.id),campaign=campaignMap.get(post?.data.consignment?.campaignId||'');
  return {key:r.key,title:r.title+(r.platform?' · '+r.platform:r.kind==='deliverable'?' · Due':''),project:project?.data.title||campaign?.data.name||(source?.storeOpenChecklist?STORE_OPEN_CHECKLIST:'Standalone'),checklist:!!(source?.storeOpenChecklist||project?.data.storeOpenChecklist),complete:source?finished(source):false,endAt:r.key.endsWith(':production')&&source?.endAt?scheduleWall(source.endAt):undefined,owner:project?.data.owner||campaign?.data.owner||r.owner,assigned:[...new Set([r.owner,r.publisher,...r.contributors].filter(Boolean))],date:r.date,dateOnly:r.dateOnly,status:source?.workflow==='task'?workStatus(source):r.stateLabel,href:r.kind==='deliverable'?(source?deliverableHref(r.id,source):'/projects/work/'+encodeURIComponent(r.id)):'/calendar?tab=entries#legacy-entry-'+encodeURIComponent(r.id),consignment:!!post?.data.consignment||post?.data.category==='Consignment',projectData:project?.data};
 });
 for(const {id,data:d} of reminders){const p=projectMap.get(d.projectId);entries.push({key:id+':reminder',title:auctionCalendarTitle(d),project:p?.data.title||'Standalone',campaign:d.campaignReference,owner:d.owner,assigned:[...new Set([d.owner,d.publisher,...d.contributors].filter(Boolean))],date:reminderDue(d),status:auctionStatuses[auctionStatus(d,p?.data)],href:deliverableHref(id,d),consignment:false,deliverableOwnerColor:true,projectData:p?.data});}
 for(const p of projects.filter(p=>!p.data.migratedToProjectId)) for(const [label,date] of [['Event',p.data.eventAt],['Auction opens',p.data.auctionOpensAt],['Auction closes',p.data.auctionClosesAt]]) if(date) entries.push({key:p.id+label,title:p.data.storeOpenChecklist&&label==='Event'?'Project due':p.data.type==='product_release'?'Release':label,project:p.data.title,checklist:!!p.data.storeOpenChecklist,complete:p.data.status==='completed',owner:p.data.owner,assigned:p.data.members,date:scheduleWall(date),status:projectStatuses[p.data.status],href:'/projects/'+encodeURIComponent(p.id)+'?tab=overview',consignment:false,projectData:p.data});
 // A single derived milestone has no separate saved calendar record to duplicate or drift.
 entries.push({key:'milestone:store-opening',milestone:'store-opening',title:STORE_OPENING_TITLE,project:STORE_OPEN_CHECKLIST,owner:'',assigned:[],date:STORE_OPENING_WALL,status:'Milestone',href:STORE_OPEN_CHECKLIST_HREF,consignment:false});
 return entries.filter(e=>e.date&&e.date.slice(0,10)>=from&&e.date.slice(0,10)<=to).sort((a,b)=>a.date.slice(0,10).localeCompare(b.date.slice(0,10))||Number(!!b.milestone)-Number(!!a.milestone)||a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
}
