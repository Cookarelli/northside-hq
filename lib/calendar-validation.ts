import {z} from 'zod';
import {chicagoInstant, stageDates, stages} from './consignment.ts';
const https = z.string().url().max(2000).refine(value => value.startsWith('https://') && !new URL(value).username && !new URL(value).password, 'Use an HTTPS link without credentials.');
const wall = z.string().refine(value => {try {chicagoInstant(value); return true;} catch {return false;}}, 'Choose a valid, unambiguous Chicago time.');
const label = z.string().trim().min(1).max(500);
export const socialPlatforms = ['facebook', 'instagram', 'x', 'youtube', 'tiktok', 'snapchat'] as const;
export const postSchema = z.object({
  title: label, date: wall, timezone: z.literal('America/Chicago'), source: z.string().max(100),
  caption: z.string().max(10000), status: z.enum(['draft','review','approved','published']),
  category: z.enum(['Topical','Release','Brand / educational','Consignment']).optional(),
  recurrence: z.literal('weekly-tuesday').optional(), references: z.array(z.union([https,z.literal('')])).max(60).transform(a => a.filter(Boolean)).optional(),
  owner: z.string().max(180).optional(), platforms: z.array(z.union([z.enum(socialPlatforms),z.literal('')])).min(1).max(7).transform(a => a.filter((x): x is typeof socialPlatforms[number] => x !== '')).optional(),
  tasks: z.array(z.string().max(2000)).max(50).optional(), assets: z.array(z.string().max(180)).max(50).transform(a => a.filter(Boolean)).optional(),
  completedTasks: z.array(z.string().max(2000)).max(50).optional(), staffPicks: z.string().max(3000).optional(),
  verification: z.object({closing: wall.optional(), lotLinksChecked:z.boolean().optional(), resultsChecked:z.boolean().optional(), reviewedCaption:z.string().max(10000).optional(),
    auction:z.object({closing:wall,batchUrl:https,cards:z.array(z.object({name:label,url:https})).min(1).max(50)}).optional(),
    results:z.array(z.object({url:https,outcome:z.enum(['unknown','sold','unsold','withdrawn']),price:z.number().finite().positive().optional(),currency:z.string().regex(/^[A-Z]{3}$/).optional()}).superRefine((r,ctx)=>{if(r.price!==undefined && (r.outcome!=='sold' || !r.currency))ctx.addIssue({code:'custom',message:'Only verified sold lots may have a price, with its currency.'});})).max(50).optional(),
  }).optional(),
  consignment: z.object({campaignId: z.string().uuid(), stage: z.enum(stages), slot: z.string().regex(/^[a-z0-9-]{1,60}$/)}).optional(),
}).superRefine((p, ctx) => {
  if (p.consignment && (!wall.safeParse(p.date).success || p.recurrence || p.category !== 'Consignment' || !p.owner || !p.platforms?.length)) ctx.addIssue({code: 'custom', message: 'Campaign posts need a valid Chicago time, owner, platforms and Consignment category.'});
});
export const campaignSchema = z.object({
  name: label, opening: wall, closing: wall, midweek: wall, recap: wall,
  auctionPlatform: label, batchUrl: https, cards: z.array(z.object({name: label, url: https})).min(1).max(50),
  owner: z.string().min(1).max(180), platforms: z.array(z.enum(socialPlatforms)).min(1).max(6),
  testPlatform: z.enum(['', 'youtube', 'tiktok', 'snapchat']),
}).superRefine((c, ctx) => {try {stageDates(c);} catch(e) {ctx.addIssue({code:'custom', message:(e as Error).message});}});
const post = z.object({id: z.string().min(1).max(180), data: postSchema});
export const campaignSaveSchema = z.object({
  id: z.string().uuid(), mutationId: z.string().uuid(), campaign: campaignSchema,
  posts: z.array(post).min(5).max(100), base: z.object({campaign: campaignSchema.nullable(), posts: z.array(post).max(100)}),
}).superRefine((payload, ctx) => {
  const ids = new Set(payload.posts.map(p => p.id));
  if (ids.size !== payload.posts.length || stages.some(stage => !payload.posts.some(p => p.data.consignment?.stage === stage))) ctx.addIssue({code:'custom', message:'Include all five stages with unique post IDs.'});
  for (const p of payload.posts) if (!p.data.consignment || p.data.consignment.campaignId !== payload.id || p.id !== `consignment_${payload.id}_${p.data.consignment.slot}`) ctx.addIssue({code:'custom', message:'Invalid campaign post identity.'});
  if (!payload.base.campaign && payload.posts.some(p => p.data.status !== 'draft')) ctx.addIssue({code:'custom', message:'New campaign posts must start as drafts.'});
});

export const templateSaveSchema=z.object({id:z.string().uuid(),templateId:z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),source:z.record(z.unknown()),data:postSchema}).strict();
export type TemplateSave=z.infer<typeof templateSaveSchema>;
