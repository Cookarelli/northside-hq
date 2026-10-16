import {MetaError,unseal,type MetaConfig,type Platform} from './core.ts';
import {Graph} from './graph.ts';
import type {Lease} from '../social/worker.ts';
type Broker=(actor:string,action:string,payload:Record<string,unknown>)=>Promise<unknown>;
type Context={connection:{page_id:string;instagram_id:string|null};ciphertext:string;payload:{phase:string;after?:string;pageCount?:number;platform?:Platform;subjectId?:string}};
export async function synchronize(lease:Lease,actor:string,broker:Broker,config:MetaConfig,graph=new Graph(config,fetch,Date.now()+15000)){
 const context=await broker(actor,'lease-context',{id:lease.id,token:lease.token}) as Context;
 if(!context?.ciphertext)throw new MetaError('credential_unavailable');
 const payload:Record<string,unknown>={id:lease.id,token:lease.token};
 try{
  const credential=unseal<{pageToken:string;userToken:string}>(context.ciphertext,config.key,`${lease.orgId}:page:${context.connection.page_id}`);
  const {connection:c,payload:p}=context;
  if(p.phase==='facebook'){
   const check=await graph.debug(credential.pageToken),userCheck=await graph.debug(credential.userToken),scopes=await graph.permissions(credential.userToken);
   const expiry=[check.expires_at,userCheck.expires_at].filter(x=>x>0),dataExpiry=[check.data_access_expires_at,userCheck.data_access_expires_at].filter((x):x is number=>!!x&&x>0);
   payload.health={scopes,expiresAt:expiry.length?new Date(Math.min(...expiry)*1000).toISOString():null,dataExpiresAt:dataExpiry.length?new Date(Math.min(...dataExpiry)*1000).toISOString():null};
  }
  if(['facebook','scheduled','instagram'].includes(p.phase)){
   if((p.pageCount||0)>=100)throw new MetaError('meta_field_unavailable'); // bounded backfill; incomplete remains unsafe to publish
   const platform=p.phase==='instagram'?'instagram':'facebook';
   const result=await graph.history(platform,platform==='instagram'?c.instagram_id!:c.page_id,platform==='instagram'?credential.userToken:credential.pageToken,p.after,p.phase==='scheduled');
   payload.posts=result.posts;
   if(!result.complete&&!result.after)throw new MetaError('meta_invalid_response');
   payload.next=result.after?{...p,after:result.after,pageCount:(p.pageCount||0)+1}:{phase:p.phase==='facebook'?'scheduled':p.phase==='scheduled'&&c.instagram_id?'instagram':'page-insights'};
  }else if(p.phase==='page-insights'){
   payload.insights=await graph.insights('page',c.page_id,credential.pageToken);payload.subjectId=c.page_id;payload.kind='page';payload.complete=true;
  }else if(p.phase==='fingerprint'&&p.subjectId){
   const platform=p.platform||'facebook';
   payload.subjectId=p.subjectId;payload.fingerprintPlatform=platform;
   try{payload.fingerprints=await graph.fingerprints(platform,platform==='instagram'?c.instagram_id!:c.page_id,p.subjectId,platform==='instagram'?credential.userToken:credential.pageToken);}catch(e){if(e instanceof MetaError&&e.code==='media_fingerprint_unavailable')payload.fingerprints=[];else throw e;}
  }else if(p.phase==='post-insights'&&p.subjectId){
   const kind=p.platform==='instagram'?'instagram':'post';payload.insights=await graph.insights(kind,p.subjectId,kind==='instagram'?credential.userToken:credential.pageToken);payload.kind=kind;payload.subjectId=p.subjectId;
  }else throw new MetaError('meta_invalid_response');
 }catch(error){const allowed=['meta_reconnect_required','meta_permission_missing','meta_rate_limited','meta_field_unavailable','meta_request_failed','meta_transport_unavailable','meta_invalid_response','credential_unavailable'];payload.error=error instanceof MetaError&&allowed.includes(error.code)?error.code:'meta_request_failed';delete payload.posts;delete payload.insights;delete payload.next;}
 await broker(actor,'finish-sync',payload);
}
