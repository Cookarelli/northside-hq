import {command,type Database} from './database.ts';
import {RadarError,type Staff} from './repository.ts';
import type {Source} from './model.ts';
import type {Entry} from './parse.ts';
import {SOURCE_SEEDS} from './seeds.ts';
import {canonicalUrl,fetchUrl} from './urls.ts';
export type Lease={source:Source;token:string;runId:string};
export async function seedSources(db:Database,_s:Staff){void _s;return command(db,'seed-sources',{sources:SOURCE_SEEDS});}
export async function editSource(db:Database,_s:Staff,id:string,data:{name:string;url:string;category:string;priority:string;enabled:boolean;mode:string;feedUrl?:string}){
 if(data.mode==='discover')try{fetchUrl(data.url,data.url);}catch{throw new RadarError(400,'Automatic collection is unavailable for this domain. Choose Manual links.');}
 if(data.feedUrl)try{fetchUrl(data.feedUrl,data.url);}catch{throw new RadarError(400,'Use a supported feed on the same approved publisher domain.');}
 return command(db,'edit-source',{id,data});
}
export async function acquireSource(db:Database,_s:Staff,id?:string,_now?:Date):Promise<Lease|null>{void _now;return command(db,'acquire-source',{id});}
async function digest(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
function leaseData(lease:Lease){return {sourceId:lease.source.id,token:lease.token,runId:lease.runId,version:lease.source.config_version};}
export async function ingestEntries(db:Database,_s:Staff,lease:Lease,entries:Entry[],_now?:Date):Promise<{added:number;duplicates:number;updates:number}>{
 void _now;
 const rows=await Promise.all(entries.slice(0,20).map(async e=>{
  const url=canonicalUrl(e.url),kind=e.eventDate||/\b(release|checklist|launch|preorder)\b/i.test(e.title)?'release':/\b(1\/1|superfractor|debut patch|chase|illustration rare|ssp|case hit)\b/i.test(e.title)?'chase':'story';
  return {...e,url,originalUrl:e.url,kind,fingerprint:await digest(JSON.stringify([e.title,e.summary,e.publishedAt,e.eventDate,e.updatedAt])),group:await digest(JSON.stringify([e.title.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim(),e.publishedAt||url,e.eventDate,kind]))};
 }));
 return command(db,'ingest-entries',{...leaseData(lease),entries:rows});
}
export async function finishSource(db:Database,_s:Staff,lease:Lease,data:{status:string;method?:string;feedUrl?:string;etag?:string|null;modified?:string|null;cursor?:string|null;error?:string;code?:string;retryAfter?:number;fetched?:number;added?:number;duplicates?:number;updates?:number}){return command(db,'finish-source',{...leaseData(lease),data});}
