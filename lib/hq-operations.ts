import {chicagoInstant,chicagoWall,scheduleWall} from './consignment.ts';
import {approvalCurrent,deliverableMissing,projectMissing,productionStatuses,type Deliverable,type HqRecord,type Project,type Staff} from './hq-model.ts';
import {isDateOnlyRelease,type CalendarPost} from './content-calendar.ts';
import {auctionCalendarTitle} from './auction-campaigns.ts';
export function addDays(day:string,days:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function instant(wall:string){try{if(/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(wall)){const value=Date.parse(wall);return Number.isFinite(value)?value:null;}return chicagoInstant(wall);}catch{return null;}}
export function finished(d:Deliverable){return d.status==='done'||(d.publishing&&Object.keys(d.publications).length>0&&Object.values(d.publications).every(p=>p.status==='published'));}
export function actionable(d:Deliverable,p?:Project){return !d.deletedAt&&!finished(d)&&!['completed','archived'].includes(p?.status||'');}
export function nextAction(d:Deliverable,p?:Project){if(d.workflow==='task')return d.status==='done'?'Complete':d.waiting?'Resume when ready':d.status==='to_do'?'Start deliverable':'Complete deliverable';if(d.blocked)return 'Resolve: '+d.blockedReason;if(!d.owner)return 'Assign an accountable owner';if(d.status==='needs_review')return 'Review the submitted version';if(d.status==='ready'&&!approvalCurrent(d,p))return 'Renew owner approval';if(d.status==='ready')return d.publishing?'Publish or confirm each platform':'Mark this task Done';if(d.status==='to_do')return 'Start production';return 'Finish production and submit for review';}
export function personName(id:string,staff:Staff[]){return staff.find(p=>p.id===id)?.name||id||'Unassigned';}
export type ScheduleRow={key:string;id:string;kind:'deliverable'|'legacy';title:string;date:string;dateOnly?:boolean;projectId:string;owner:string;publisher:string;contributors:string[];format:string;platform:string;status:string;productionStatus:string;stateLabel:string;ready:boolean;action:string;recurring?:boolean};
export function scheduleRows(records:HqRecord<Deliverable>[],projects:HqRecord<Project>[],mode:'publication'|'production',legacy:CalendarPost[]=[],from='',to=''):ScheduleRow[]{
 const rows:ScheduleRow[]=[];
 for(const {id,data:d} of records){if(d.deletedAt)continue;const p=projects.find(p=>p.id===d.projectId)?.data,base={id,kind:'deliverable' as const,title:auctionCalendarTitle(d),projectId:d.projectId,owner:d.owner,publisher:d.publisher||'',contributors:d.contributors,format:d.format,productionStatus:d.status,ready:d.status==='ready'&&approvalCurrent(d,p)&&!d.blocked,action:nextAction(d,p)};
  if(mode==='production'){rows.push({...base,key:id+':production',date:d.productionDue,platform:'',status:d.status,stateLabel:d.workflow==='task'?(d.status==='done'?'Complete':d.waiting?'Waiting':d.status==='to_do'?'Not Started':'In Progress'):productionStatuses[d.status]});continue;}
  if(!d.publishing)continue;
  for(const platform of d.platforms){const publication=d.publications[platform]||{status:'planned'};rows.push({...base,key:id+':'+platform,date:publication.status==='published'?publication.publishedAt||'':publication.status==='scheduled'?publication.scheduledFor||'':d.publishAt,platform,status:publication.status,stateLabel:{planned:'Planned',scheduled:'Scheduled',published:'Published'}[publication.status]});}
 }
 if(mode==='publication')for(const {id,data:p} of legacy){
  // Retired imported release calendar; keep staff-authored release work and saved records.
  if(p.category==='Release'&&p.source==='topps')continue;
  const dates:string[]=[];
  if(p.recurrence&&from&&to){for(let day=from,n=0;day<=to&&n<93;day=addDays(day,1),n++)if(new Date(day+'T12:00:00Z').getUTCDay()===2&&day>=p.date.slice(0,10))dates.push(day+'T'+p.date.slice(11,16));}
  else dates.push(p.date);
  for(const date of dates)for(const platform of p.platforms?.length?p.platforms:[p.source])rows.push({key:'legacy:'+id+':'+date+':'+platform,id,kind:'legacy',title:p.title,date,dateOnly:isDateOnlyRelease(p),projectId:p.consignment?'legacy:'+p.consignment.campaignId:'',owner:p.owner||'',publisher:'',contributors:[],format:'',platform,status:'legacy:'+p.status,productionStatus:p.status,stateLabel:'Legacy '+p.status+' · unconfirmed',ready:false,action:'Open the preserved calendar editor',recurring:!!p.recurrence});
 }
 return rows.map(row=>({...row,date:scheduleWall(row.date)})).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||a.key.localeCompare(b.key));
}
export type ScheduleFilters={person:string;project:string;format:string;platform:string;status:string;from:string;to:string;mode:'publication'|'production'};
export function filterSchedule(rows:ScheduleRow[],f:ScheduleFilters){return rows.filter(r=>(!f.person||(f.person==='unassigned'?!(f.mode==='publication'&&r.kind==='deliverable'?r.publisher:r.owner):[r.owner,r.publisher,...r.contributors].includes(f.person)))&&(!f.project||(f.project==='standalone'?!r.projectId:r.projectId===f.project))&&(!f.format||(f.format==='missing'?!r.format:r.format===f.format))&&(!f.platform||r.platform===f.platform)&&(!f.status||r.status===f.status||r.productionStatus===f.status)&&(!r.date||((!f.from||r.date.slice(0,10)>=f.from)&&(!f.to||r.date.slice(0,10)<=f.to))));}
export function todayDashboard(records:HqRecord<Deliverable>[],projects:HqRecord<Project>[],staffId:string,now:number){
 const day=chicagoWall(now).slice(0,10),tomorrow=addDays(day,1),soonEnd=addDays(day,7),projectFor=(d:Deliverable)=>projects.find(p=>p.id===d.projectId)?.data;
 const open=records.filter(r=>actionable(r.data,projectFor(r.data))).sort((a,b)=>(a.data.productionDue||'9999').localeCompare(b.data.productionDue||'9999'));
 const assigned=(d:Deliverable)=>d.owner===staffId||d.contributors.includes(staffId);
 const dueSoon=open.filter(({data:d})=>assigned(d)&&!['ready','done'].includes(d.status)&&!!d.productionDue&&d.productionDue.slice(0,10)<=soonEnd);
 const overdue=open.filter(({data:d})=>!['ready','done'].includes(d.status)&&(instant(d.productionDue)??Infinity)<now);
 const publication=scheduleRows(records.filter(r=>!['completed','archived'].includes(projectFor(r.data)?.status||'')||finished(r.data)),projects,'publication');
 const publishing=publication.filter(r=>r.date.slice(0,10)===day||r.date.slice(0,10)===tomorrow);
 const missingProjects=projects.filter(p=>!['completed','archived'].includes(p.data.status)).flatMap(p=>{const dates=[p.data.eventAt,p.data.auctionOpensAt,p.data.auctionClosesAt].filter(x=>x&&x.slice(0,10)>=day&&x.slice(0,10)<=soonEnd).sort();if(!dates.length)return [];const children=records.filter(d=>d.data.projectId===p.id);const missing=[...projectMissing(p.data),...(p.data.status==='draft'?['Activate this project']:[]),...(!children.length?['Plan deliverables']:children.filter(d=>!finished(d.data)).flatMap(d=>deliverableMissing(d.data,p.data).map(x=>d.data.title+': '+x)))];return missing.length?[{...p,date:dates[0],missing}]:[];});
 return {day,tomorrow,dueSoon,approvals:open.filter(({data:d})=>d.status==='needs_review'&&(d.projectId?projectFor(d)?.owner:d.approver)===staffId),myBlocks:open.filter(r=>r.data.blocked&&r.data.blockedBy===staffId),myPublishing:publication.filter(r=>r.publisher===staffId&&r.date.slice(0,10)===day),publishing,ready:publishing.filter(r=>r.status!=='published'&&r.ready),unfinished:publishing.filter(r=>r.status!=='published'&&!r.ready),overduePublishing:publication.filter(r=>r.status!=='published'&&(instant(r.date)??Infinity)<now&&open.some(d=>d.id===r.id)),overdue,blocked:open.filter(r=>r.data.blocked),unassigned:open.filter(r=>!r.data.owner||(r.data.publishing&&!r.data.publisher)),unassignedProjects:projects.filter(r=>!r.data.owner&&!['completed','archived'].includes(r.data.status)),missingProjects};
}
export type SpendSummary={advertisingCents:number;creativeCents:number;totalCents:number};
export type SpendEntry={id:string;project_id:string;category:'advertising'|'creative';amount_cents:number;channel:string;spent_on:string;note:string;actor:string;created_at:string;reverses:string|null;reversed:boolean};
export function budgetTotals(project:Project,actual:SpendSummary){const approved=project.budget?.amountCents??null,planned=project.allocations.reduce((sum,a)=>sum+a.amountCents,0);return {...actual,approved,planned,unallocated:approved===null?null:approved-planned,remaining:approved===null?null:approved-actual.totalCents,overage:approved===null?0:Math.max(0,actual.totalCents-approved),unapprovedSpend:approved===null&&actual.totalCents>0};}
