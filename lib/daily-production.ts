import {z} from 'zod';
import {blankDeliverable,approvalCurrent,type Deliverable,type HqRecord,type Project} from './hq-model.ts';
import {chicagoInstant,scheduleWall} from './consignment.ts';

export const contentPillars=['The New Northside','Northside Buys','Northside Sports Desk','Meet Northside','The Hobby Report','Northside Collects'] as const;
export const originalFormats={video:'Video',static:'Static',carousel:'Carousel'} as const;
export const storyPlatforms=['facebook','instagram'] as const;
export const metricNames=['views','reach','likes','comments','shares','saves','clicks'] as const;
export const productionDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;},'Choose a valid date.');
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),version=z.number().int().min(0).max(99999999);
const time=z.string().refine(v=>{try{chicagoInstant(v);return true;}catch{return false;}},'Choose an unambiguous Chicago date and time.');
const url=z.string().max(2000).url().refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use an HTTPS URL without credentials.');
const classification={pillar:z.enum(contentPillars),format:z.enum(['video','static','carousel']),original:z.boolean()};
const assignment={title:z.string().trim().min(1).max(300),owner:id,approver:id,publisher:id,productionDue:time,publishAt:time,platforms:z.array(z.enum(['facebook','instagram','x','youtube','tiktok','snapchat'])).min(1).max(6).refine(v=>new Set(v).size===v.length)};
export const dailyProductionCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),id,...classification,...assignment}).strict(),
 z.object({action:z.literal('classify'),id,version,recordVersion:version,...classification}).strict(),
 z.object({action:z.literal('story'),id,version,recordVersion:version,platform:z.enum(storyPlatforms),status:z.enum(['planned','scheduled','published']),time:z.union([time,z.literal('')]),url:z.union([url,z.literal('')]),unavailableReason:z.string().trim().max(1000),confirmed:z.literal(true)}).strict(),
 z.object({action:z.literal('metrics'),id,requestId:z.string().uuid(),platform:z.enum(['facebook','instagram','x','youtube','tiktok','snapchat']),surface:z.enum(['feed','story']),observedAt:time,period:z.enum(['lifetime','day']),periodDate:z.union([productionDay,z.literal('')]),evidenceUrl:url,values:z.object(Object.fromEntries(metricNames.map(n=>[n,z.number().int().min(0).max(999999999999).nullable()])) as Record<typeof metricNames[number],z.ZodNullable<z.ZodNumber>>).strict()}).strict(),
]);
export type Classification=z.infer<typeof dailyProductionCommand> & {action:'classify'};
export type DailyContent={deliverable_id:string;pillar:typeof contentPillars[number];format:keyof typeof originalFormats;original:boolean;version:number;stories:Partial<Record<typeof storyPlatforms[number],{status:'planned'|'scheduled'|'published';time?:string;url?:string;unavailableReason?:string;by?:string;recordedAt?:string}>>};
export type MetricSnapshot={id:string;deliverable_id:string;platform:string;surface:'feed'|'story';observed_at:string;period:'lifetime'|'day';period_date:string|null;evidence_url:string;values:Record<typeof metricNames[number],number|null>;actor:string;created_at:string};
export type DailyData={content:DailyContent[];metrics:MetricSnapshot[];nextOffset:number|null};
export function dailyTargets(day:string){const quota=day<'2026-10-20'?0:day<'2026-11-03'?3:4;return {video:quota,static:quota,stories:{facebook:quota*2,instagram:quota*2}};}
export function chicagoToday(now=new Date()){return scheduleWall(now.toISOString()).slice(0,10);}
export function dueDay(d:Deliverable){return scheduleWall(d.publishAt||'').slice(0,10);}
export function dailyRows(day:string,content:DailyContent[],records:HqRecord<Deliverable>[]){const map=new Map(content.map(c=>[c.deliverable_id,c]));return records.filter(r=>!r.data.deletedAt&&r.data.workflow!=='task'&&r.data.publishing&&dueDay(r.data)===day).map(r=>({...r,classification:map.get(r.id)}));}
export function productionScore(day:string,rows:ReturnType<typeof dailyRows>,projects:HqRecord<Project>[]){
 const target=dailyTargets(day),projectMap=new Map(projects.map(p=>[p.id,p.data]));
 const originals=rows.filter(r=>r.classification?.original);
 const count=(format:'video'|'static')=>{const a=originals.filter(r=>format==='video'?r.classification?.format==='video':['static','carousel'].includes(r.classification!.format));return {planned:a.length,approved:a.filter(r=>approvalCurrent(r.data,projectMap.get(r.data.projectId))).length,published:a.filter(r=>r.data.platforms.length>0&&r.data.platforms.every(p=>r.data.publications[p]?.status==='published')).length,target:target[format]};};
 return {video:count('video'),static:count('static'),unclassified:rows.filter(r=>!r.classification).length,blocked:rows.filter(r=>r.data.blocked).length,stories:Object.fromEntries(storyPlatforms.map(p=>[p,{planned:originals.length,published:originals.filter(r=>r.classification?.stories[p]?.status==='published').length,target:target.stories[p]}])) as Record<typeof storyPlatforms[number],{planned:number;published:number;target:number}>};
}
export const productionTemplates=contentPillars.map((pillar,index)=>({id:String(index),pillar,title:["Inside the new Northside","What Northside is buying","Northside Sports Desk update","Meet the Northside team","This week in the hobby","Northside Collects spotlight"][index],brief:[
 'Show one verified store update. Capture the real space or product, explain what changed, and confirm opening details before writing a CTA.',
 'Show an item Northside is currently buying. Confirm buying criteria and staff-approved terms; explain how a collector can contact the shop.',
 'Connect a verified sports event to cards in the shop. Keep the existing MNF, fantasy, rankings, TNF/Locks and weekend cadence. Verify names, dates and claims.',
 'Introduce a real staff member or consenting collector. Record their role, a personal collecting story and a clear invitation to visit.',
 'Explain a verified release, hobby headline or collecting lesson. Keep source links, confirm rights and identify opinion clearly.',
 'Spotlight a real card, collection or auction. Verify item/lot links and the actual close; retain existing weekly auction reminders and recap.'
 ][index]}));
export function templateDeliverable(input:z.infer<typeof dailyProductionCommand> & {action:'create'}){
 const template=productionTemplates.find(t=>t.pillar===input.pillar)!;
 return {...blankDeliverable,title:input.title,owner:input.owner,approver:input.approver,publisher:input.publisher,productionDue:input.productionDue,publishAt:input.publishAt,platforms:input.platforms,format:originalFormats[input.format],instructions:template.brief+'\nProduce '+originalFormats[input.format].toLowerCase()+' creative. Caption, final media and factual review are required. Repost the published original to Facebook and Instagram Stories; confirm each manually.'};
}
