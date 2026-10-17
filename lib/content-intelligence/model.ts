import {z} from 'zod';
import {chicagoInstant} from '../consignment.ts';

export const categories = ['Sports','New releases','Chase cards','Consignment','Auctions','Pokemon','Entertainment cards','Store promotions','Unclassified'] as const;
export const templates = ['community-source','collector-question'] as const;
export const platforms = ['facebook','instagram'] as const;
export type Category = typeof categories[number];
export type Platform = typeof platforms[number];
export type Template = typeof templates[number];
export const metricNames = ['views','impressions','reach','likes','reactions','comments','shares','saves','paidViews','organicViews','paidImpressions','organicImpressions','paidReach','organicReach'] as const;
export type MetricName = typeof metricNames[number];
export type Metrics = Partial<Record<MetricName,number|null>>;
export type Snapshot = {id:string;page_id:string;platform:Platform;subject_id:string;kind:'post'|'account';observed_at:string;metrics:Metrics;unavailable:string[]};
export type Post = {page_id:string;platform:Platform;external_id:string;caption:string;url:string|null;published_at:string|null;media_type:string;state:string};
export type Label = {page_id:string;platform:Platform;external_id:string;category:Category;template:Template|null;campaign_id:string|null;campaign_kind:'project'|'campaign'|null;version:number};
export const campaignKey=(kind:string,id:string)=>`${kind}:${id}`;
export type Idea = {
 id:string;itemId:string|null;headline:string;category:Category;sourceUrl:string;publishedAt:string|null;
 whyToday:string;window:{start:string;end:string;timezone:'America/Chicago';basis:string};
 confidence:'low'|'medium'|'high';verification:'unverified'|'verified';template:Template;
 originalImagesRequired:boolean;inventoryRequired:boolean;facebook:string;instagram:string;checks:string[];
};
export type Report = {id:string;kind:'briefing'|'daily'|'weekly';report_day:string;created_at:string;data:{ideas:Idea[];notes:string[];summary?:unknown}};
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const rangeInput = z.object({from:day,to:day,channel:z.enum(['all',...platforms]).default('all'),category:z.enum(['all',...categories]).default('all'),campaign:z.string().max(190).default('')}).refine(v=>v.from<=v.to&&(Date.parse(v.to)-Date.parse(v.from))/86400000<=365,'Choose a range of at most 366 days.');
export const commandInput = z.discriminatedUnion('action',[
 z.object({action:z.literal('generate'),kind:z.enum(['briefing','daily','weekly']),requestId:z.string().uuid()}).strict(),
 z.object({action:z.literal('handoff'),reportId:z.string().uuid(),ideaId:z.string().max(180),calendar:z.boolean(),date:z.string().refine(v=>{try{chicagoInstant(v);return true;}catch{return false;}},'Choose an unambiguous Chicago date and time.')}).strict(),
 z.object({action:z.literal('label'),pageId:z.string().regex(/^\d+$/),platform:z.enum(platforms),externalId:z.string().regex(/^\d+(?:_\d+)?$/),version:z.number().int().nonnegative(),category:z.enum(categories),template:z.enum(templates).nullable(),campaignId:z.string().max(180).nullable(),campaignKind:z.enum(['project','campaign']).nullable()}).strict(),
 z.object({action:z.literal('sync'),pageId:z.string().regex(/^\d+$/),platform:z.enum(platforms),mode:z.enum(['history','current','metrics'])}).strict(),
 z.object({action:z.literal('campaign-link'),campaignId:z.string().min(1).max(180),campaignKind:z.enum(['project','campaign']),reportingKey:z.string().max(180).nullable(),version:z.number().int().nonnegative()}).strict(),
]);
export function freshness(last:string|null,cadenceMinutes:number,now=new Date()){
 if(!last||!Number.isFinite(Date.parse(last)))return 'Never checked';
 return now.getTime()-Date.parse(last)<=cadenceMinutes*60000?'Fresh':'Due';
}
