import {z} from 'zod';
import {chicagoInstant,scheduleWall} from './consignment.ts';
import {postSchema} from './calendar-validation.ts';
import type {CalendarPostData} from './content-calendar';
import type {Campaign} from './consignment';

export const projectTypes = {weekly_auction:'Weekly Auction', event:'Event', product_release:'Product Release', general:'General'} as const;
export const projectStatuses = {draft:'Draft', active:'Active', completed:'Completed', archived:'Archived'} as const;
export const productionStatuses = {to_do:'To do', in_progress:'In progress', needs_review:'Needs review', ready:'Ready', done:'Done'} as const;
export const effortLevels = {quick:'Quick', standard:'Standard', premium:'Premium'} as const;
export const destinations = ['facebook','instagram','x','youtube','tiktok','snapchat','email','website'] as const;
export const materialRoles = {reference:'Reference',draft:'Draft',final:'Final'} as const;
export type MaterialRole=keyof typeof materialRoles;
const text = z.string().max(12000);
const staffId = z.string().max(180);
const wall = z.string().refine(value => {if (!value) return true; try {chicagoInstant(value); return true;} catch {return false;}}, 'Choose a valid, unambiguous America/Chicago time.');
const https = z.string().max(2000).url().refine(value => {try {const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password;} catch {return false;}}, 'Use an HTTPS link without credentials.');
const roleMap=z.record(z.string().max(2000),z.enum(['reference','draft','final'])).refine(v=>Object.keys(v).length<=60,'Use at most 60 classified materials.');
const materials={assets:z.array(staffId).max(60),references:z.array(https).max(60),assetRoles:roleMap.default({}),linkRoles:roleMap.default({})};
const common = {title:z.string().trim().min(1, 'Add a title.').max(300),owner:staffId,...materials};
export const projectInput = z.object({...common,
  type:z.enum(['weekly_auction','event','product_release','general']), brief:text, members:z.array(staffId).max(50), status:z.enum(['draft','active','completed','archived']),
  eventAt:wall, auctionOpensAt:wall, auctionClosesAt:wall,
  allocations:z.array(z.object({channel:z.string().trim().min(1).max(80),amountCents:z.number().int().min(0).max(999999999999)}).strict()).max(30),
  auction:z.object({auctionPlatform:z.string().max(300),batchUrl:https,cards:z.array(z.object({name:z.string().min(1).max(500),url:https})).min(1).max(50)}).nullable(),
}).strict();
export const deliverableInput = z.object({...common,
  instructions:text,contributors:z.array(staffId).max(50),projectId:staffId,approver:staffId,productionDue:wall,publishAt:wall,format:z.string().max(300),platforms:z.array(z.enum(destinations)).max(8),caption:text,destinationUrl:z.union([https,z.literal('')]),
  effort:z.enum(['quick','standard','premium']),estimatedHours:z.number().min(0).max(10000).nullable(),publishing:z.boolean(),blocked:z.boolean(),blockedReason:text,blockedBy:staffId,
  evidence:z.object({completedTasks:z.array(z.string().max(2000)).max(50).optional(),staffPicks:z.string().max(3000).optional(),verification:postSchema.innerType().shape.verification}).strict(),
  publisher:staffId,requiresFinalFile:z.boolean(),requiresCaption:z.boolean(),promotionMode:z.enum(['organic','paid']),promotionChannel:z.string().max(80),promotionCents:z.number().int().min(0).max(999999999999),
}).strict();
export const requestInput=z.object({title:common.title,purpose:z.string().trim().min(1,'Tell us what this is for.').max(6000),requestedDeadline:wall,...materials}).strict();
export type RequestInput=z.infer<typeof requestInput>;
export type HqRequest=RequestInput & Metadata & {requester:string;status:'new'|'accepted'|'declined';decision?:{by:string;at:string;reason:string};conversion?:{kind:'project'|'deliverable';id:string};decisionId?:string};
export type ProjectInput = z.infer<typeof projectInput>;
export type DeliverableInput = z.infer<typeof deliverableInput>;
type Metadata = {version:number;createdBy:string;createdAt:string;updatedAt:string};
export type Budget = {amountCents:number;currency:'USD';approvedBy:string;approvedAt:string;version:number};
export type PublishingPackage={finalAssets:string[];finalLinks:string[];caption:string;destinationUrl:string;publisher:string;platforms:string[];publishAt:string;promotionMode:'organic'|'paid';promotionChannel:string;promotionCents:number};
export type Approval = {by:string;at:string;projectVersion:number|null;budgetVersion:number|null;reviewedVersion?:number;approvedVersion?:number;contentVersion?:number;comment?:string;package?:PublishingPackage};
export type Publication = {status:'planned'|'scheduled'|'published';scheduledFor?:string;scheduledBy?:string;scheduledAt?:string;publishedAt?:string;liveUrl?:string;unavailableReason?:string;recordedBy?:string;recordedAt?:string;approval?:Approval};
export type Project = ProjectInput & Metadata & {budget:Budget|null;legacyCampaignId?:string;migratedToProjectId?:string;migratedAt?:string};
export type Deliverable = {campaignReference?:string;sourceProjectId?:string;campaignBrief?:string;campaignAuction?:ProjectInput['auction'];auctionClosesAt?:string;reminderHours?:number;workflow?:'task';waiting?:boolean;priority?:'low'|'normal'|'high'|'urgent';notes?:string;endAt?:string;completedAt?:string;deletedAt?:string;deletedBy?:string} & Omit<DeliverableInput,'effort'|'evidence'> & Metadata & {effort:DeliverableInput['effort']|null;evidence:Pick<CalendarPostData,'completedTasks'|'staffPicks'|'verification'>;status:keyof typeof productionStatuses;approval:Approval|null;publications:Record<string,Publication>;legacyPostId?:string;legacyPost?:CalendarPostData;legacyEditorialId?:string;editorialSource?:{version:number;data:{state:string;facebook:string;instagram:string;cta:string;permission:string;permissionEvidence:string;attribution:string;references:string[]}};contentVersion?:number;submission?:{by:string;to:string;at:string;contentVersion:number;recordVersion:number}|null;review?:{by:string;at:string;decision:'approve'|'changes';comment:string;reviewedVersion:number}};
export type HqRecord<T> = {id:string;data:T};
export type Staff = {id:string;name:string;budgetApprover:boolean;requestCoordinator:boolean};
export type HqContext = {staffId:string;admin:boolean;canApproveBudget:boolean;canCoordinate:boolean;staff:Staff[]};
export type WorkspaceRecord = {kind:string;id:string;data:unknown};
export const blankProject:ProjectInput = {title:'',type:'general',brief:'',owner:'',members:[],status:'draft',eventAt:'',auctionOpensAt:'',auctionClosesAt:'',assets:[],references:[],assetRoles:{},linkRoles:{},allocations:[],auction:null};
export const blankDeliverable:DeliverableInput = {title:'',instructions:'',owner:'',contributors:[],projectId:'',approver:'',productionDue:'',publishAt:'',format:'',platforms:['facebook','instagram'],caption:'',destinationUrl:'',effort:'standard',estimatedHours:null,publishing:true,blocked:false,blockedReason:'',blockedBy:'',assets:[],references:[],assetRoles:{},linkRoles:{},evidence:{},publisher:'',requiresFinalFile:true,requiresCaption:true,promotionMode:'organic',promotionChannel:'',promotionCents:0};
export const blankRequest:RequestInput={title:'',purpose:'',requestedDeadline:'',assets:[],references:[],assetRoles:{},linkRoles:{}};
export function projectDraft(p:Project):ProjectInput {
  const draft=Object.fromEntries(Object.keys(blankProject).map(k=>[k,p[k as keyof ProjectInput]??blankProject[k as keyof ProjectInput]])) as ProjectInput;
  return {...draft,eventAt:scheduleWall(draft.eventAt),auctionOpensAt:scheduleWall(draft.auctionOpensAt),auctionClosesAt:scheduleWall(draft.auctionClosesAt)};
}
export function deliverableDraft(d:Deliverable):DeliverableInput {
  const draft=Object.fromEntries(Object.keys(blankDeliverable).map(k=>[k,k==='effort' ? d.effort || '' : d[k as keyof DeliverableInput]??(k==='requiresCaption'||k==='requiresFinalFile'?d.publishing:blankDeliverable[k as keyof DeliverableInput])])) as DeliverableInput;
  return {...draft,productionDue:scheduleWall(draft.productionDue),publishAt:scheduleWall(draft.publishAt)};
}
export function finalMaterials(d:Pick<Deliverable,'assets'|'references'|'assetRoles'|'linkRoles'>) {return {finalAssets:d.assets.filter(id=>d.assetRoles?.[id]==='final'),finalLinks:d.references.filter(url=>d.linkRoles?.[url]==='final')};}
export function projectMissing(p:Project|ProjectInput) {
  const issues:string[]=[];
  if (!p.owner) issues.push('Project owner'); if (!p.brief.trim()) issues.push('Project brief');
  if (['event','product_release'].includes(p.type)&&!p.eventAt) issues.push(p.type==='event'?'Event date':'Release date');
  if (p.type==='weekly_auction') {if(!p.auctionOpensAt) issues.push('Auction opening');if(!p.auctionClosesAt) issues.push('Auction closing');}
  return issues;
}
export function approvalCurrent(d:Deliverable,p?:Project) {
  return !!d.approval?.approvedVersion && d.approval.contentVersion===d.contentVersion && d.approval.by===(d.projectId?p?.owner:d.approver) && (!d.projectId || (p?.status==='active' && (d.promotionMode!=='paid'||!!p.budget) && d.approval.projectVersion===p.version));
}
export function deliverableMissing(d:Deliverable,p?:Project) {
  const issues:string[]=[];
  if(!d.owner) issues.push('Accountable owner'); if(!d.instructions.trim()) issues.push('Instructions'); if(!d.productionDue) issues.push('Production deadline'); if(!d.effort) issues.push('Effort');
  if(d.projectId) {if(!p?.owner) issues.push('Project owner');if(p?.status!=='active') issues.push('Active project');} else if(!d.approver) issues.push('Standalone approver');
  if(d.requiresFinalFile&&!finalMaterials(d).finalAssets.length&&!finalMaterials(d).finalLinks.length) issues.push('Attach and mark a final file or final external link');
  if(d.publishing) {if(!d.format) issues.push('Format');if(!d.platforms.length) issues.push('Destination platforms');if(d.requiresCaption&&!d.caption.trim()) issues.push('Caption');if(!d.publishAt) issues.push('Intended publication time');if(!d.publisher) issues.push('Assigned publisher');if(d.requiresCaption===undefined||d.requiresFinalFile===undefined) issues.push('Choose output requirements');if(!d.requiresCaption&&!d.requiresFinalFile&&!d.destinationUrl) issues.push('A final file, caption or destination link');}
  if(d.editorialSource&&d.editorialSource.data.state!=='Approved')issues.push('Current editorial source approval');
  if(d.promotionMode==='paid'&&(!p?.budget||!d.promotionChannel||!d.promotionCents)) issues.push('Approved project promotion allocation');
  if(d.blocked) issues.push('Resolve: '+d.blockedReason);
  if(d.status==='ready'&&!approvalCurrent(d,p)) issues.push('Renew owner approval after project changes');
  return issues;
}
export function canWork(d:Deliverable,p:Project|undefined,c:HqContext) {return c.admin || d.owner===c.staffId || d.publisher===c.staffId || d.contributors.includes(c.staffId) || p?.owner===c.staffId || !!p?.members.includes(c.staffId) || (!d.projectId&&d.approver===c.staffId);}
export function auctionFor(p:Project):Campaign|undefined {return p.auction?{...p.auction,name:p.title,opening:p.auctionOpensAt,closing:p.auctionClosesAt,owner:p.owner,midweek:'',recap:'',platforms:[],testPlatform:''}:undefined;}
export function evidencePost(d:Deliverable):CalendarPostData {return {...d.legacyPost!,...d.evidence,date:d.publishAt,caption:d.caption,references:d.references,assets:[...(d.legacyPost?.assets||[]),...d.assets]};}
export function recordedTime(value:string) {return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' CT';}

const id=z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/);
const version=z.number().int().min(0).max(99999999);
export const hqCommand = z.discriminatedUnion('action',[
  z.object({action:z.literal('save-project'),id,version,data:projectInput}).strict(),
  z.object({action:z.literal('save-deliverable'),id,version,data:deliverableInput}).strict(),
  z.object({action:z.literal('budget'),id,version,amountCents:z.number().int().min(0).max(999999999999)}).strict(),
  z.object({action:z.literal('production'),id,version,status:z.enum(['to_do','in_progress','needs_review','ready','done'])}).strict(),
  z.object({action:z.literal('review'),id,version,decision:z.enum(['approve','changes']),comment:z.string().trim().max(5000)}).strict(),
  z.object({action:z.literal('publication'),id,version,platform:z.enum(destinations),status:z.enum(['planned','scheduled','published']),confirmed:z.literal(true),time:wall,url:z.union([https,z.literal('')]),unavailableReason:z.string().max(1000)}).strict(),
  z.object({action:z.literal('comment'),id,kind:z.enum(['project','deliverable','request']),commentId:z.string().uuid(),body:z.string().trim().min(1).max(5000),mentions:z.array(staffId).max(50).default([])}).strict(),
  z.object({action:z.literal('permission'),staffId,capability:z.enum(['budget_approve','coordinate_requests']).default('budget_approve'),enabled:z.boolean()}).strict(),
  z.object({action:z.literal('save-request'),id,version,data:requestInput}).strict(),
  z.object({action:z.literal('decide-request'),id,version,decisionId:z.string().uuid(),decision:z.enum(['accepted','declined']),reason:z.string().trim().max(5000),targetKind:z.enum(['project','deliverable']).default('project'),targetId:z.string().max(180).default(''),owner:staffId.default(''),approver:staffId.default(''),projectType:z.enum(['weekly_auction','event','product_release','general']).default('general'),publishing:z.boolean().default(false),platforms:z.array(z.enum(destinations)).max(8).default([]),effort:z.enum(['quick','standard','premium']).default('standard')}).strict(),
  z.object({action:z.literal('reschedule'),id,version,field:z.enum(['productionDue','publishAt']),time:wall}).strict(),
  z.object({action:z.literal('reminders')}).strict(),
  z.object({action:z.literal('notification-read'),id:z.string().uuid(),read:z.boolean()}).strict(),
  z.object({action:z.literal('spend'),id:z.string().uuid(),projectId:id,category:z.enum(['advertising','creative']),amountCents:z.number().int().positive().max(999999999999),spentOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;},'Choose a valid spending date.'),channel:z.string().trim().max(80),note:z.string().trim().min(1).max(2000)}).strict(),
  z.object({action:z.literal('spend-reverse'),id:z.string().uuid(),projectId:id,reverses:z.string().uuid(),note:z.string().trim().min(1).max(2000)}).strict(),
  z.object({action:z.literal('adopt-editorial'),id,owner:staffId,approver:staffId,effort:z.enum(['quick','standard','premium'])}).strict(),
  z.object({action:z.literal('adopt-campaign'),id}).strict(),z.object({action:z.literal('adopt-post'),id}).strict(),
]);
