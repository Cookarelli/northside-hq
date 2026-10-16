import {mediaFingerprint} from './media.ts';
import {MetaError,objectId,proof,READ_SCOPES,safePlatformURL,type MetaConfig,type Platform} from './core.ts';
export type Page={id:string;name:string;access_token:string;tasks?:string[];instagram_business_account?:{id:string;username?:string;name?:string}};
export type Token={access_token:string;expires_in?:number};
export type RemotePost={id:string;caption:string;url:string|null;publishedAt:string|null;mediaIds:string[];mediaType:string;verifiedAt:string};
type Edge<T>={data:T[];paging?:{cursors?:{after?:string};next?:string}};
type FBPost={id:string;message?:string;permalink_url?:string;created_time?:string;is_published?:boolean;attachments?:{data:{target?:{id?:string};subattachments?:{data:{target?:{id?:string}}[]}}[]}};
type IGPost={id:string;caption?:string;permalink?:string;timestamp?:string;media_type?:string;children?:{data:{id:string}[]}};
export const METRICS={page:['page_media_view','page_post_engagements','page_follows'],post:['post_media_view','post_reactions_by_type_total'],instagram:['views','likes','comments','saved','shares']} as const;
export class Graph {
 config:MetaConfig; transport:typeof fetch; deadline:number;
 constructor(config:MetaConfig,transport:typeof fetch=fetch,deadline=Date.now()+45000){this.config=config;this.transport=transport;this.deadline=deadline;}
 async request<T>(path:string,token:string,params:Record<string,string>={},oauth=false):Promise<T>{
  if(!/^(?:me(?:\/accounts|\/permissions)?|oauth\/access_token|debug_token|\d+(?:_\d+)?(?:\/(?:published_posts|scheduled_posts|media|insights))?)$/.test(path))throw new MetaError('invalid_graph_path');
  const u=new URL(`https://graph.facebook.com/${this.config.version}/${path}`);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  if(!oauth)u.searchParams.set('appsecret_proof',proof(token,this.config.appSecret));
  const remaining=this.deadline-Date.now();if(remaining<=0)throw new MetaError('meta_transport_unavailable');
  let response:Response;
  try{response=await this.transport(u,{headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(Math.min(7000,remaining))});}catch{throw new MetaError('meta_transport_unavailable');}
  let result:unknown;try{const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let bytes=0;for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2_000_000){await reader.cancel();throw Error();}chunks.push(value);}result=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new MetaError('meta_invalid_response');}
  const error=(result as {error?:{code?:number}})?.error;
  if(!response.ok||error){const code=error?.code;throw new MetaError(code===190?'meta_reconnect_required':code===10||code===200?'meta_permission_missing':response.status===429||[4,17,32,613,80001].includes(code||0)?'meta_rate_limited':code===100?'meta_field_unavailable':'meta_request_failed');}
  return result as T;
 }
 async exchange(code:string){
  const short=await this.request<Token>('oauth/access_token','',{client_id:this.config.appId,client_secret:this.config.appSecret,redirect_uri:this.config.redirectUri,code},true);
  if(!short.access_token)throw new MetaError('meta_invalid_response');
  const token=await this.request<Token>('oauth/access_token','',{grant_type:'fb_exchange_token',client_id:this.config.appId,client_secret:this.config.appSecret,fb_exchange_token:short.access_token},true);
  if(!token.access_token)throw new MetaError('meta_invalid_response');return token;
 }
 async permissions(token:string){const r=await this.request<Edge<{permission:string;status:string}>>('me/permissions',token);return r.data.filter(x=>x.status==='granted').map(x=>x.permission);}
 async debug(token:string){const r=await this.request<{data:{is_valid:boolean;app_id:string;expires_at:number;data_access_expires_at?:number;scopes?:string[]}}>('debug_token',`${this.config.appId}|${this.config.appSecret}`,{input_token:token},true);if(!r.data.is_valid||String(r.data.app_id)!==this.config.appId)throw new MetaError('meta_reconnect_required');return r.data;}
 async pages(token:string,after?:string){return this.request<Edge<Page>>('me/accounts',token,{fields:'id,name,access_token,tasks,instagram_business_account{id,username,name}',limit:'25',...(after?{after}: {})});}
 async page(token:string,id:string){return this.request<Page>(objectId(id),token,{fields:'id,name,access_token,tasks,instagram_business_account{id,username,name}'});}
 async history(platform:Platform,id:string,token:string,after?:string,scheduled=false){
  const path=`${objectId(id)}/${platform==='instagram'?'media':scheduled?'scheduled_posts':'published_posts'}`;
  const fields=platform==='instagram'?'id,caption,permalink,timestamp,media_type,children{id}':'id,message,permalink_url,created_time,is_published,attachments{target,subattachments{target}}';
  const r=await this.request<Edge<FBPost&IGPost>>(path,token,{fields,limit:'25',...(after?{after}:{})});
  return {posts:r.data.map(x=>this.post(platform,x)),after:r.paging?.next?r.paging.cursors?.after:null,complete:!r.paging?.next};
 }
 post(platform:Platform,x:FBPost&IGPost):RemotePost {
  const stamp=platform==='facebook'?x.created_time:x.timestamp;
  const publishedAt=stamp&&Number.isFinite(Date.parse(stamp))?new Date(stamp).toISOString():null;
  return {id:objectId(x.id),caption:(platform==='facebook'?x.message:x.caption)||'',url:safePlatformURL(platform==='facebook'?x.permalink_url:x.permalink,platform),publishedAt,mediaIds:platform==='instagram'?(x.children?.data.map(a=>objectId(a.id))||[x.id]):(x.attachments?.data.flatMap(a=>[a.target?.id,...(a.subattachments?.data.map(b=>b.target?.id)||[])]).filter((id):id is string=>!!id&&/^\d+$/.test(id))||[]),mediaType:x.media_type||'POST',verifiedAt:new Date().toISOString()};
 }
 async verify(platform:Platform,account:string,id:string,token:string){
  // Page ownership is encoded in Facebook post IDs; Instagram ownership is checked via owner.
  if(platform==='facebook'&&!id.startsWith(objectId(account)+'_'))throw new MetaError('receipt_account_mismatch');
  const x=await this.request<FBPost&IGPost&{owner?:{id:string}}>(objectId(id),token,{fields:platform==='facebook'?'id,message,permalink_url,created_time,is_published':'id,caption,permalink,timestamp,media_type,owner'});
  if(platform==='instagram'&&x.owner?.id!==account)throw new MetaError('receipt_account_mismatch');
  const post=this.post(platform,x);if(platform==='facebook'&&x.is_published!==true||!post.url||!post.publishedAt)throw new MetaError('receipt_unverified');return post;
 }
 async fingerprints(platform:Platform,account:string,id:string,token:string){
  if(platform==='facebook'&&!id.startsWith(objectId(account)+'_'))throw new MetaError('receipt_account_mismatch');
  type Media={id?:string;media_url?:string;owner?:{id:string};children?:{data:Media[];paging?:{next?:string}};attachments?:{data:{media?:{image?:{src?:string};source?:string};subattachments?:{data:{media?:{image?:{src?:string};source?:string}}[]}}[]}};
  const x=await this.request<Media>(objectId(id),token,{fields:platform==='instagram'?'id,owner,media_url,children{id,media_url}':'id,attachments{media,subattachments{media}}'});
  if(platform==='instagram'&&x.owner?.id!==account)throw new MetaError('receipt_account_mismatch');
  const urls=platform==='instagram'?(x.children?.data.map(m=>m.media_url)||[x.media_url]):(x.attachments?.data.flatMap(a=>a.subattachments?.data.map(m=>m.media?.source||m.media?.image?.src)||[a.media?.source||a.media?.image?.src])||[]);
  if(!urls.length||urls.length>4||urls.some(u=>!u)||x.children?.paging?.next)throw new MetaError('media_fingerprint_unavailable');
  const hashes:string[]=[];for(const url of urls)hashes.push(await mediaFingerprint(url!,this.transport));return hashes;
 }
 async insights(kind:keyof typeof METRICS,id:string,token:string){
  const metrics:Record<string,unknown>={},unavailable:string[]=[];
  // Each metric is isolated: unsupported media types cannot erase valid metrics.
  for(const metric of METRICS[kind]){
   try{const r=await this.request<Edge<{name:string;period?:string;values?:unknown[];total_value?:unknown}>>(`${objectId(id)}/insights`,token,{metric,...(kind==='page'?{period:'day'}:kind==='post'?{period:'lifetime'}:{})});
    const value=r.data.find(x=>x.name===metric);if(value)metrics[metric]=cleanMetric(value);else unavailable.push(metric);
   }catch(e){if(e instanceof MetaError&&e.code==='meta_field_unavailable')unavailable.push(metric);else throw e;}
  }return {metrics,unavailable,observedAt:new Date().toISOString()};
 }
}
export function diagnostics(scopes:string[],tasks:string[],expiresAt:string|null,dataExpiresAt:string|null,instagramId:string|null){const missing=READ_SCOPES.filter(x=>!scopes.includes(x));const expiry=[expiresAt,dataExpiresAt].filter((x):x is string=>!!x).map(Date.parse);return {missingPermissions:missing,missingPageTasks:tasks.includes('ANALYZE')?[]:['ANALYZE'],instagramConnected:!!instagramId,expiresSoon:expiry.some(t=>t<Date.now()+7*86400000),expired:expiry.some(t=>t<=Date.now()),livePublishing:false};}

function cleanMetric(metric:{period?:string;values?:unknown[];total_value?:unknown}){
 const numeric=(v:unknown):unknown=>typeof v==='number'&&Number.isFinite(v)?v:v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k,n])=>/^[a-z_]+$/i.test(k)&&typeof n==='number'&&Number.isFinite(n))):null;
 return {period:metric.period?.slice(0,30),values:metric.values?.slice(0,100).map(v=>{const x=v as {value?:unknown;end_time?:string};return {value:numeric(x.value),end_time:x.end_time&&Number.isFinite(Date.parse(x.end_time))?new Date(x.end_time).toISOString():null};}),total_value:numeric((metric.total_value as {value?:unknown}|undefined)?.value)};
}
