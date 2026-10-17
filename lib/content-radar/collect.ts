import type {Database} from './database.ts';
import {createReader,CollectionError} from './fetch.ts';
import type {Reader,DocumentResult} from './fetch.ts';
import {parseFeed,parsePage,discoverFeeds,robotsAllowed,retained,pageMetadata} from './parse.ts';
import {fetchUrl} from './urls.ts';
import {acquireSource,finishSource,ingestEntries,seedSources} from './collection-repository.ts';
import type {Staff} from './repository.ts';
import type {Source} from './model.ts';
import type {Entry} from './parse.ts';

async function allowPage(reader:Reader,url:string){
 try{const robots=await reader(new URL('/robots.txt',url).href);if(!robotsAllowed(robots.body,url))throw new CollectionError('blocked','Publisher robots rules prohibit collecting this page.');}
 catch(e){if(e instanceof CollectionError&&e.code==='http'&&e.message.includes('404'))return;throw e;}
}
export async function collectSource(source:Source,reader:Reader){
 const target=source.feed_url||source.url;
 const validators=source.cursor?{}:{etag:source.etag,modified:source.modified};
 if(source.feed_url||['rss','atom'].includes(source.method)){
  const document=await reader(target,validators);if(document.status===304)return {document,method:source.method,entries:[] as Entry[]};
  const feed=parseFeed(document.body,document.url);if(!feed)throw new CollectionError('format','Saved feed no longer returns RSS or Atom. Edit the source to rediscover it.');
  return {document,method:feed.method,entries:feed.entries};
 }
 await allowPage(reader,source.url);
 const document=await reader(source.url,validators);
 if(document.status===304)return {document,method:source.method,entries:[] as Entry[]};
 const direct=parseFeed(document.body,document.url);if(direct)return {document,method:direct.method,entries:direct.entries};
 const feeds=discoverFeeds(document.body,document.url);
 for(const feedUrl of feeds){
  try{fetchUrl(feedUrl,source.url);}catch{continue;}
  const candidate=await reader(feedUrl),feed=parseFeed(candidate.body,candidate.url);
  if(feed)return {document:candidate,method:feed.method,entries:feed.entries};
 }
 const entries=parsePage(document.body,document.url);
 if(!source.allow_page)throw new CollectionError('permission','No supported feed found. Record publisher permission before enabling bounded page retrieval.',86400);
 if(!entries.length)throw new CollectionError('format','No usable article or release metadata found. This page may require a browser; add links manually.');
 return {document,method:'page',entries};
}
async function signature(entries:Entry[]){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(entries))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function refreshSource(db:Database,staff:Staff,id?:string,options:{readerFactory?:(s:Source)=>Reader;now?:Date}={}){
 await seedSources(db,staff);
 const lease=await acquireSource(db,staff,id,options.now);if(!lease)return {ok:true,status:'skipped',message:'No source is due. Paused, manual, busy, and recently checked sources are skipped.'};
 const {source}=lease;
 try{
  const reader=options.readerFactory?.(source)||createReader(source.url);
  const result=await collectSource(source,reader);
  if(result.document.status===304){await finishSource(db,staff,lease,{status:'unchanged',etag:result.document.etag||source.etag,modified:result.document.modified||source.modified,retryAfter:(source.cadence_minutes||1440)*60});return {ok:true,status:'unchanged',source:source.name,added:0,duplicates:0};}
  const entries=retained(result.entries,options.now||new Date()),hash=await signature(entries);
  let offset=0;try{const c=JSON.parse(source.cursor||'null');if(c?.hash===hash&&Number.isInteger(c.offset)&&c.offset>=0)offset=c.offset;}catch{}
  const batch=entries.slice(offset,offset+20),counts=await ingestEntries(db,staff,lease,batch,options.now);
  const next=offset+batch.length,cursor=next<entries.length?JSON.stringify({hash,offset:next}):null;
  await finishSource(db,staff,lease,{status:'success',method:result.method,feedUrl:['rss','atom'].includes(result.method)?result.document.url:undefined,etag:result.document.etag,modified:result.document.modified,cursor,retryAfter:cursor?60:(source.cadence_minutes||1440)*60,fetched:batch.length,...counts});
  return {ok:true,status:'success',source:source.name,fetched:batch.length,pending:!!cursor,...counts};
 }catch(e){
  const error=e instanceof CollectionError?e:new CollectionError('collection','Collection could not finish. Check your source settings and staff access.');
  await finishSource(db,staff,lease,{status:'failed',error:error.message,code:error.code,retryAfter:error.retryAfter});
  return {ok:true,status:'failed',source:source.name,message:error.message};
 }
}
export async function retrieveMetadata(url:string){
 // No server fetch for Instagram or arbitrary staff-supplied hosts. Staff can
 // always enter the title/date/notes manually, including after a publisher error.
 try{fetchUrl(url,url);}catch{return {ok:true,manual:true,message:'Automatic metadata is unavailable for this address. Enter the headline, date, and notes below.'};}
 try{const reader=createReader(url,{maxRequests:4,deadline:Date.now()+12000});await allowPage(reader,url);const document:DocumentResult=await reader(url);const metadata=pageMetadata(document.body,document.url);if(!metadata)throw new Error();return {ok:true,metadata};}
 catch{return {ok:true,manual:true,message:'The publisher did not provide usable metadata. Your link is kept; enter the details manually.'};}
}
