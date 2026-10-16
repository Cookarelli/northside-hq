import {MetaError,contentHash,objectId,type Platform} from './core.ts';
import {Graph,type RemotePost} from './graph.ts';
export type PublicationInput={idempotencyKey:string;platform:Platform;accountId:string;approvedRevision:number;caption:string;scheduledAt:string;imageUrl?:string;containerId?:string};
// Plans are reviewable descriptions, never executable transports. No flag enables POSTs.
export function publicationPlan(input:PublicationInput){
 objectId(input.accountId);
 if(!Number.isInteger(input.approvedRevision)||input.approvedRevision<1||!input.idempotencyKey||!input.caption.trim()||!Number.isFinite(Date.parse(input.scheduledAt)))throw new MetaError('invalid_publication');
 if(input.platform==='facebook')return {method:'POST',path:`${input.accountId}/feed`,body:{message:input.caption},dispatchAt:input.scheduledAt};
 if(!input.imageUrl)throw new MetaError('instagram_image_required');
 const image=new URL(input.imageUrl);if(image.protocol!=='https:'||image.username||image.password)throw new MetaError('invalid_media_url');
 return {method:'POST',path:`${input.accountId}/media`,body:{image_url:image.href,caption:input.caption},dispatchAt:input.scheduledAt,next:{method:'POST',path:`${input.accountId}/media_publish`,body:{creation_id:'<persisted-FINISHED-container-id>'}}};
}
export class MetaPublicationAdapter {
 graph:Graph;
 constructor(graph:Graph){this.graph=graph;}
 async publish(_input:PublicationInput):Promise<never>{void _input;throw new MetaError('live_publishing_disabled');}
 async verify(input:{platform:Platform;accountId:string;externalId:string;token:string}){return this.graph.verify(input.platform,input.accountId,input.externalId,input.token);}
 async reconcile(input:{platform:Platform;accountId:string;externalId?:string;caption:string;token:string;attemptedAt:string}){
  if(input.externalId){try{const post=await this.verify({...input,externalId:input.externalId});if(contentHash(post.caption)!==contentHash(input.caption))throw new MetaError('receipt_content_mismatch');return {state:'verified' as const,post,retryAllowed:false};}catch{return {state:'uncertain' as const,candidates:[] as RemotePost[],retryAllowed:false};}}
  // A matching caption is evidence for an operator, never proof that this attempt created it.
  const history=await this.graph.history(input.platform,input.accountId,input.token);
  const since=Date.parse(input.attemptedAt)-60000;
  const candidates=history.posts.filter(p=>contentHash(p.caption)===contentHash(input.caption)&&p.publishedAt&&Date.parse(p.publishedAt)>=since);
  return {state:'uncertain' as const,candidates,retryAllowed:false};
 }
}
