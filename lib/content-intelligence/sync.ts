import {Graph,type RemotePost} from '../meta/graph.ts';
import {MetaError,objectId,unseal,type MetaConfig} from '../meta/core.ts';
import {normalizeLegacyMetrics} from './analytics.ts';
import type {Metrics,Platform} from './model.ts';

export type SyncInput={pageId:string;platform:Platform;mode:'history'|'current'|'metrics'};
type Context={skipped?:boolean;complete?:boolean;reason?:string;retryAt?:string;org:string;account:string;token:string;after:string|null;watermark:string|null;until:string;ciphertext:string;posts?:{external_id:string}[]};
type Broker=(action:string,payload:Record<string,unknown>)=>Promise<unknown>;
type Edge={data:(Parameters<Graph['post']>[1])[];paging?:{cursors?:{after?:string};next?:string}};
const metricMap={facebook:{post_media_view:'views',post_reactions_by_type_total:'reactions'},instagram:{views:'views',reach:'reach',likes:'likes',comments:'comments',saved:'saves',shares:'shares'}} as const;

export async function readPostMetrics(graph:Graph,platform:Platform,id:string,token:string){
 // Removed v26 metrics are not queried or substituted with views. Historical values remain readable.
 const metrics:Metrics={impressions:null,paidViews:null,organicViews:null,paidImpressions:null,organicImpressions:null,paidReach:null,organicReach:null},unavailable:string[]=['impressions','paid/organic breakdown'];
 if(platform==='facebook'){metrics.reach=null;metrics.likes=null;metrics.saves=null;unavailable.push('reach','likes','saves');}
 else {metrics.reactions=null;unavailable.push('reactions');}
 for(const [remote,name] of Object.entries(metricMap[platform])){
  try{
   const result=await graph.request<{data:{name:string;period?:string;values?:{value?:unknown}[];total_value?:{value?:unknown}}[]}>(`${objectId(id)}/insights`,token,{metric:remote,...(platform==='facebook'?{period:'lifetime'}:{})});
   const row=result.data.find(x=>x.name===remote),value=row?.period&&row.period!=='lifetime'?null:row?.total_value?.value??row?.values?.at(-1)?.value;
   const n=typeof value==='number'?value:remote==='post_reactions_by_type_total'&&value&&typeof value==='object'&&Object.values(value).length>0&&Object.values(value).every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)?Object.values(value).reduce<number>((a,b)=>a+(b as number),0):null;
   if(n===null||!Number.isFinite(n)||n<0){metrics[name]=null;unavailable.push(remote);}else metrics[name]=n;
  }catch(e){if(e instanceof MetaError&&e.code==='meta_field_unavailable'){metrics[name]=null;unavailable.push(remote);}else throw e;}
 }
 if(platform==='facebook'){
  // Facebook comment/share summaries are distinct from reaction insight metrics.
  for(const field of ['comments','shares'] as const){try{
   const r=await graph.request<{comments?:{summary?:{total_count?:number}};shares?:{count?:number}}>(objectId(id),token,{fields:field==='comments'?'comments.limit(0).summary(true)':'shares'});
   const value=field==='comments'?r.comments?.summary?.total_count:r.shares?.count;
   metrics[field]=typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;if(metrics[field]===null)unavailable.push(field);
  }catch(e){if(e instanceof MetaError&&e.code==='meta_field_unavailable'){metrics[field]=null;unavailable.push(field);}else throw e;}}
 }
 return {metrics,unavailable};
}

export async function syncBatch(input:SyncInput,broker:Broker,config:MetaConfig,graph=new Graph(config,fetch,Date.now()+55000)){
 const context=await broker('claim',input) as Context;
 if(context.skipped)return {skipped:true,complete:context.complete,reason:context.reason,retryAt:context.retryAt};
 const payload:Record<string,unknown>={...input,token:context.token};
 try{
  const credentials=unseal<{pageToken:string;userToken:string}>(context.ciphertext,config.key,`${context.org}:page:${input.pageId}`);
  const token=input.platform==='facebook'?credentials.pageToken:credentials.userToken;
  if(input.mode==='metrics'){
   const post=context.posts?.[0];payload.snapshots=post?[{id:post.external_id,...await readPostMetrics(graph,input.platform,post.external_id,token)}]:[];
   payload.after=context.posts&&context.posts.length>1?post!.external_id:null;
  }else{
   const since=input.mode==='current'&&context.watermark?String(Math.floor(Date.parse(context.watermark)/1000)-48*3600):undefined;
   const edge=await graph.request<Edge>(`${objectId(context.account)}/${input.platform==='instagram'?'media':'published_posts'}`,token,{
    fields:input.platform==='instagram'?'id,caption,permalink,timestamp,media_type,children{id}':'id,message,permalink_url,created_time,is_published,attachments{target,subattachments{target}}',limit:'25',
    ...(context.after?{after:context.after}:{}),
    // Instagram /media has cursor pagination, not Facebook's since/until contract.
    ...(input.platform==='facebook'?{until:String(Math.floor(Date.parse(context.until)/1000)),...(since?{since}:{})}:{}),
   });
   if(!Array.isArray(edge.data)||edge.data.length>25||edge.paging?.next&&(!edge.paging.cursors?.after||edge.paging.cursors.after===context.after))throw new MetaError('meta_invalid_response');
   const posts:RemotePost[]=edge.data.map(row=>graph.post(input.platform,row));
   payload.posts=posts;payload.after=edge.paging?.next?edge.paging.cursors!.after:null;
  }
 }catch(error){
  const codes=['meta_reconnect_required','meta_permission_missing','meta_rate_limited','meta_field_unavailable','meta_request_failed','meta_transport_unavailable','meta_invalid_response','credential_unavailable'];
  payload.error=error instanceof MetaError&&codes.includes(error.code)?error.code:'meta_request_failed';
  delete payload.posts;delete payload.snapshots;delete payload.after;
 }
 return broker('finish',payload);
}

export function snapshotMetrics(row:{format?:string;metrics:Record<string,unknown>}){
 return row.format==='meta'?normalizeLegacyMetrics(row.metrics):row.metrics as Metrics;
}
