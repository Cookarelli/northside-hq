import {z} from 'zod';
import {chicagoInstant,chicagoWall,scheduleWall} from './consignment.ts';
import type {Deliverable} from './hq-model';

export const auctionCampaignInput=z.object({name:z.string().trim().min(1).max(300),auction_number:z.number().int().min(1).max(999999999),closesAt:z.string().refine(value=>{try{chicagoInstant(value);return true;}catch{return false;}},'Choose a valid, unambiguous America/Chicago closing time.')}).strict();
export type AuctionCampaignData=z.infer<typeof auctionCampaignInput>&{projectId:string;version:number;createdAt:string;updatedAt:string};
export const auctionCampaignCommand=z.object({action:z.literal('save-auction-campaign'),id:z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),version:z.number().int().min(1),data:auctionCampaignInput}).strict();
export const auctionLabel=(number:number|undefined)=>number?'Auction #'+number:'Auction';
export function reminderDue(d:Deliverable){
 if(d.productionDue)return scheduleWall(d.productionDue);
 if(!d.auctionClosesAt||![48,24,2].includes(d.reminderHours||0))return '';
 try {const close=/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(d.auctionClosesAt)?Date.parse(d.auctionClosesAt):chicagoInstant(d.auctionClosesAt);return chicagoWall(close-d.reminderHours!*3600000);}catch{return '';}
}
export function auctionCalendarTitle(d:Deliverable){return (d.auction_number?'#'+d.auction_number+' ':'')+d.title.replace(/ Auction(?= — )/,'');}
export function deliverableHref(id:string,d:Deliverable){return d.projectId&&d.campaignReference?'/projects/'+encodeURIComponent(d.projectId)+'?deliverable='+encodeURIComponent(id)+'#deliverable-'+encodeURIComponent(id):'/projects/work/'+encodeURIComponent(id);}
