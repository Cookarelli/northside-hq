import {z} from 'zod';
import {approvalCurrent,canWork,deliverableInput,deliverableMissing,type Deliverable,type HqContext,type HqRecord,type Project} from './hq-model.ts';
import {instant} from './hq-operations.ts';
import {deliverableBudgetInput} from './deliverable-budget.ts';
import {scheduleWall} from './consignment.ts';

export const auctionStatuses={not_started:'Not Started',in_progress:'In Progress',review:'Ready for Review',approved:'Approved',scheduled:'Scheduled',published:'Published'} as const;
export type AuctionStatus=keyof typeof auctionStatuses;
export function auctionStatus(d:Deliverable,p?:Project):AuctionStatus {
 const states=d.platforms.map(platform=>d.publications[platform]?.status||'planned');
 if(states.length&&states.every(status=>status==='published'))return 'published';
 if(states.length&&states.every(status=>status==='scheduled'||status==='published'))return 'scheduled';
 if(d.status==='ready')return approvalCurrent(d,p)?'approved':'review';
 if(d.status==='needs_review')return 'review';
 return d.status==='to_do'?'not_started':'in_progress';
}
export function publicationSummary(d:Deliverable) {
 const states=d.platforms.map(platform=>d.publications[platform]?.status||'planned');
 const published=states.filter(s=>s==='published').length,scheduled=states.filter(s=>s==='scheduled').length;
 return published||scheduled?`${published} of ${states.length} published · ${scheduled} scheduled`:'';
}
export function reminderLabel(d:Deliverable) {
 return [48,24,2].includes(d.reminderHours||0)?`${d.reminderHours} Hour Reminder`:d.title;
}
export function campaignGroups(records:HqRecord<Deliverable>[]) {
 const groups=new Map<string,{key:string;name:string;records:HqRecord<Deliverable>[]} >();
 for(const record of records){
  const d=record.data,name=d.campaignReference?.trim();
  if(!name||d.deletedAt||!d.publishing||d.workflow==='task')continue;
  const key=d.auctionCampaignId||JSON.stringify([name,d.auction_number||'',d.sourceProjectId||'',scheduleWall(d.auctionClosesAt||'').slice(0,10)]);
  if(!groups.has(key))groups.set(key,{key,name,records:[]});
  groups.get(key)!.records.push(record);
 }
 const byDue=(a:HqRecord<Deliverable>,b:HqRecord<Deliverable>)=>(instant(a.data.productionDue)??Infinity)-(instant(b.data.productionDue)??Infinity)||((b.data.reminderHours||0)-(a.data.reminderHours||0))||a.id.localeCompare(b.id);
 return [...groups.values()].map(g=>({...g,records:g.records.sort(byDue)})).sort((a,b)=>(b.records[0].data.auction_number||0)-(a.records[0].data.auction_number||0)||byDue(a.records[0],b.records[0])||a.name.localeCompare(b.name));
}
export function auctionStatusOptions(d:Deliverable,p:Project,c:HqContext):AuctionStatus[] {
 if(d.deletedAt||['completed','archived'].includes(p.status)||!canWork(d,p,c))return [];
 const confirmed=d.platforms.some(platform=>['scheduled','published'].includes(d.publications[platform]?.status));
 const options:AuctionStatus[]=[];
 if(!confirmed){
  if(d.status==='in_progress')options.push('not_started');
  if(['to_do','needs_review','done'].includes(d.status))options.push('in_progress');
  if(['in_progress','ready'].includes(d.status))options.push('review');
  if(d.status==='needs_review'&&!deliverableMissing(d,p).length&&d.submission?.contentVersion===d.contentVersion)options.push('approved');
 }
 if(d.publishing&&d.status==='ready'&&!d.blocked&&approvalCurrent(d,p)){
  if(d.platforms.some(platform=>d.publications[platform]?.status!=='published'))options.push('scheduled','published');
 }
 return options;
}
export function auctionStatusCommand(status:AuctionStatus,record:HqRecord<Deliverable>) {
 const common={id:record.id,version:record.data.version};
 if(status==='approved')return {...common,action:'review',decision:'approve',comment:''};
 const production={not_started:'to_do',in_progress:'in_progress',review:'needs_review'} as const;
 return status in production?{...common,action:'production',status:production[status as keyof typeof production]}:null;
}

// Shared validation for the editor and its single transactional save endpoint.
export const auctionEditorCommand=z.object({action:z.literal('save-auction-deliverable'),id:z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),version:z.number().int().min(1),data:deliverableInput,budget:deliverableBudgetInput.optional(),metadata:z.object({priority:z.enum(['low','normal','high','urgent']),notes:z.string().max(12000)}).strict()}).strict();
