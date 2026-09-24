import {z} from 'zod';
import {chicagoInstant,chicagoWall,scheduleWall} from './consignment.ts';
import {maxBudgetCents} from './deliverable-budget.ts';
import type {Deliverable,HqContext,HqRecord,Project} from './hq-model';

const cents=z.number().int().min(0).max(maxBudgetCents).nullable();
const https=z.string().max(2000).url().refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use HTTPS links without credentials.');
const fields={featuredCard:z.string().max(4000),auctionPlatform:z.string().max(300),auctionUrl:z.union([https,z.literal('')]),lotUrls:z.array(https).max(20),owner:z.string().min(1).max(180),assignees:z.array(z.string().min(1).max(180)).max(50),assetLinks:z.array(https).max(40),internalNotes:z.string().max(12000),campaignBudgetCents:cents};
export const auctionCampaignInput=z.object({name:z.string().trim().min(1).max(240),auction_number:z.number().int().min(1).max(999999999),closesAt:z.string().refine(value=>{try{const wall=chicagoWall(chicagoInstant(value));return new Date(wall.slice(0,10)+'T12:00:00Z').getUTCDay()===0;}catch{return false;}},'Choose a valid Sunday closing time in America/Chicago.')}).extend(z.object(fields).partial().shape).strict();
export const auctionCampaignCreateInput=auctionCampaignInput.extend(fields).strict();
export type AuctionCampaignInput=z.infer<typeof auctionCampaignCreateInput>;
export type AuctionCampaignData=z.infer<typeof auctionCampaignInput>&{reconciliation?:{at:string;by:string;budgetCents:number|null;actualCents:number;varianceCents:number|null}|null;projectId:string;sourceProjectId?:string;version:number;createdAt:string;updatedAt:string};
export const auctionCampaignCommand=z.object({action:z.literal('save-auction-campaign'),id:z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),version:z.number().int().min(1),data:auctionCampaignInput}).strict();
export const createAuctionCampaignCommand=z.object({action:z.literal('create-auction-campaign'),id:z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/),projectId:z.string().min(1).max(180),data:auctionCampaignCreateInput,plannedBudgets:z.object({'48':cents,'24':cents,'2':cents}).strict()}).strict();
export function nextAuctionNumber(campaigns:HqRecord<AuctionCampaignData>[]){return campaigns.reduce((max,c)=>Math.max(max,c.data.auction_number),0)+1;}
export function isWeeklyAuctionHome(project:HqRecord<Project>,campaigns:HqRecord<AuctionCampaignData>[]){return !project.data.migratedToProjectId&&campaigns.some(c=>c.data.projectId===project.id&&c.data.sourceProjectId==='mj-consignment-video-2026-09-23');}
export function canManageAuction(p:Project,c:HqContext,campaign?:AuctionCampaignData){return c.admin||p.owner===c.staffId||p.members.includes(c.staffId)||campaign?.owner===c.staffId;}
export function allocationLabel(target:number|null|undefined,allocated:bigint){if(target==null)return 'Campaign budget not set';const difference=BigInt(target)-allocated;return difference===BigInt(0)?'Fully allocated':difference>BigInt(0)?'Unallocated':'Overallocated';}
export const auctionLabel=(number:number|undefined)=>number?'Auction #'+number:'Auction';
export function reminderDue(d:Deliverable){
 if(d.productionDue)return scheduleWall(d.productionDue);
 if(!d.auctionClosesAt||![48,24,2].includes(d.reminderHours||0))return '';
 try {const close=/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(d.auctionClosesAt)?Date.parse(d.auctionClosesAt):chicagoInstant(d.auctionClosesAt);return chicagoWall(close-d.reminderHours!*3600000);}catch{return '';}
}
export function auctionCalendarTitle(d:Deliverable){return (d.auction_number?'#'+d.auction_number+' ':'')+(/^#\d+\s+/.test(d.title)?d.title.replace(/^#\d+\s+/,''):d.title.replace(/^Michael Jordan Auction(?= — )/,'Michael Jordan'));}
export function deliverableHref(id:string,d:Pick<Deliverable,'projectId'>){return d.projectId?'/projects/'+encodeURIComponent(d.projectId)+'?tab=deliverables&deliverable='+encodeURIComponent(id)+'#deliverable-'+encodeURIComponent(id):'/projects/work/'+encodeURIComponent(id);}
