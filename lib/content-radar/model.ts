import { z } from 'zod';
import { canonicalUrl } from './urls.ts';

export const CATEGORIES = ['Baseball', 'Football', 'Basketball', 'Hockey', 'Pokemon', 'Other TCG', 'Memorabilia', 'Local Events', 'Entertainment cards', 'Consignment', 'Auctions', 'Store promotions'] as const;
export const PRIORITIES = ['normal', 'high', 'urgent'] as const;
export const STATUSES = ['new', 'saved', 'dismissed'] as const;
export const KINDS = ['story', 'release', 'chase'] as const;
export const VERIFY = ['unverified', 'verified', 'disputed'] as const;
export const DRAFT_STATUSES = ['draft', 'review', 'approved'] as const;
export const CHANNELS = ['instagram', 'facebook', 'tiktok', 'x', 'email'] as const;
export const sourceUrl = z.string().trim().max(2048).url().refine(value => {
  try {const u = new URL(value);return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;}catch{return false;}
}, 'Use an HTTP or HTTPS link without embedded credentials.').transform(value => {
  return canonicalUrl(value);
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Use a valid date.');
export const itemInput = z.object({
  title: z.string().trim().min(1).max(300), url: sourceUrl,
  sourceId: z.string().uuid().nullable(), category: z.enum(CATEGORIES), kind: z.enum(KINDS),
  priority: z.enum(PRIORITIES), publishedAt: date.nullable(), eventDate: date.nullable(),
  summary: z.string().trim().max(4000), tags: z.array(z.string().trim().min(1).max(40)).max(12),
}).strict();
export const sourceInput = z.object({ name: z.string().trim().min(1).max(150), url: sourceUrl, category: z.enum(CATEGORIES) }).strict();
export const sourceSettings = sourceInput.extend({priority:z.enum(PRIORITIES),enabled:z.boolean(),mode:z.enum(['manual','discover']),cadenceMinutes:z.number().int().min(60).max(10080).default(1440),allowPage:z.boolean().default(false),permissionNote:z.string().trim().max(1000).default(''),feedUrl:sourceUrl.or(z.literal('')).default('')}).strict().refine(v=>!v.allowPage||v.permissionNote.length>=10,'Record publisher permission before enabling page retrieval.');
export const commandInput = z.discriminatedUnion('action', [
  z.object({action:z.literal('add-item'), data:itemInput}).strict(),
  z.object({action:z.literal('seed-sources')}).strict(),
  z.object({action:z.literal('refresh-sources'),sourceId:z.string().uuid().optional()}).strict(),
  z.object({action:z.literal('metadata'),url:sourceUrl}).strict(),
  z.object({action:z.literal('edit-source'),id:z.string().uuid(),data:sourceSettings}).strict(),
  z.object({action:z.literal('add-source'), data:sourceInput}).strict(),
  z.object({action:z.literal('set-status'), id:z.string().uuid(), status:z.enum(STATUSES)}).strict(),
  z.object({action:z.literal('verify'), id:z.string().uuid(), verification:z.enum(VERIFY)}).strict(),
  z.object({action:z.literal('save-idea'), id:z.string().uuid()}).strict(),
  z.object({action:z.literal('edit-draft'), id:z.string().uuid(), title:z.string().trim().min(1).max(300), body:z.string().max(10000), channel:z.enum(CHANNELS), status:z.enum(DRAFT_STATUSES)}).strict(),
]);
export type RadarCommand = z.infer<typeof commandInput>;
export type Item = {id:string; title:string; url:string; source_id:string|null; source_name:string|null; category:typeof CATEGORIES[number]; kind:typeof KINDS[number]; priority:typeof PRIORITIES[number]; status:typeof STATUSES[number]; verification:typeof VERIFY[number]; published_at:string|null; collected_at:string; event_date:string|null; summary:string; tags:string};
export type Draft = {id:string; item_id:string; title:string; body:string; channel:typeof CHANNELS[number]; status:typeof DRAFT_STATUSES[number]; updated_at:string};
export type Source = {id:string; name:string; url:string; category:string; verification:string; created_at:string;method:string;connection_status:string;priority:typeof PRIORITIES[number];enabled:number;feed_url:string|null;last_attempt:string|null;last_success:string|null;last_error:string|null;error_code:string|null;next_attempt:string|null;etag:string|null;modified:string|null;cursor:string|null;config_version:number;cadence_minutes?:number;allow_page?:boolean;permission_note?:string};
export type Publication={id:string;item_id:string;source_id:string;source_name:string;original_url:string;title:string;excerpt:string;published_at:string|null;event_date:string|null;observed_at:string};
export type History = {id:string; item_id:string; entity:string; from_status:string|null; to_status:string; actor:string; created_at:string};
export type RadarData = {items:Item[]; drafts:Draft[]; sources:Source[]; history:History[]; publications:Publication[]; runs:{id:string; status:string; started_at:string; finished_at:string|null; error:string|null;source_name:string|null;fetched:number;added:number;duplicates:number;updates:number}[]; total:number; hasMore:boolean};
export type Filters = {tab:string; q:string; category:string; source:string; after:string; before:string; priority:string; status:string; offset:number};
export const emptyFilters: Filters = {tab:'feed', q:'', category:'all', source:'all', after:'', before:'', priority:'all', status:'all', offset:0};
export const filterInput = z.object({
  tab:z.enum(['feed','releases','chase','drafts','sources']).default('feed'), q:z.string().max(200).default(''),
  category:z.enum(['all',...CATEGORIES]).default('all'), source:z.union([z.literal('all'),z.literal('manual'),z.string().uuid()]).default('all'),
  after:date.or(z.literal('')).default(''), before:date.or(z.literal('')).default(''),
  priority:z.enum(['all',...PRIORITIES]).default('all'), status:z.enum(['all',...STATUSES,...DRAFT_STATUSES]).default('all'),
  offset:z.coerce.number().int().min(0).max(1000000).default(0),
}).refine(f => !f.after || !f.before || f.after <= f.before, 'Start date must be on or before end date.');
