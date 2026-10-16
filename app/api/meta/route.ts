import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db,identity,bucket,getRecord} from '@/lib/storage';
import {agreementGate} from '@/lib/agreements';
import {configuration,seal,unseal,MetaError} from '@/lib/meta/core';
import {Graph,diagnostics} from '@/lib/meta/graph';
import {metaIdentity,metaService,metaError,metaHeaders} from '@/lib/meta/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type UserCredential={token:string;scopes:string[];expiresAt:string|null;dataExpiresAt:string|null};
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('fingerprint'),assetId:z.string().min(1).max(180)}).strict(),
 z.object({action:z.literal('schedule'),pageId:z.string().regex(/^\d+$/),queueId:z.string().min(1).max(100),version:z.number().int().positive(),platform:z.enum(['facebook','instagram']),scheduledAt:z.string().datetime(),requestId:z.string().uuid()}).strict(),
 z.object({action:z.literal('pages'),after:z.string().max(2000).optional()}).strict(),
 z.object({action:z.literal('select'),pageId:z.string().regex(/^\d+$/)}).strict(),
 z.object({action:z.literal('sync'),pageId:z.string().regex(/^\d+$/),requestId:z.string().uuid()}).strict(),
 z.object({action:z.literal('disconnect'),pageId:z.string().regex(/^\d+$/)}).strict(),
 z.object({action:z.literal('prepare'),pageId:z.string().regex(/^\d+$/),postId:z.string().uuid(),requestId:z.string().uuid()}).strict(),
]);
export async function GET(request:Request){try{
 const org=await identity(),client=await db();if((await agreementGate(client)).required)throw new Error('Forbidden');
 const url=new URL(request.url),offset=Number(url.searchParams.get('offset')||0);if(!Number.isInteger(offset)||offset<0||offset>100000)throw new MetaError('meta_precondition_failed');
 const results=await Promise.all([
  client.from('meta_connections').select('*').eq('org_id',org).order('page_id').limit(100),
  client.from('meta_imports').select('*').eq('org_id',org).order('synced_at',{ascending:false}).order('external_id').range(offset,offset+49),
  client.from('meta_insights').select('*').eq('org_id',org).order('observed_at',{ascending:false}).limit(100),
  client.from('meta_intents').select('*').eq('org_id',org).order('created_at',{ascending:false}).limit(100),
 ]);if(results.some(x=>x.error))throw new MetaError('meta_storage_unavailable');
 const [connections,history,insights,intents]=results.map(x=>x.data||[]);
 return Response.json({connections:connections.map(c=>({...c,diagnostics:diagnostics(c.scopes,c.tasks,c.token_expires_at,c.data_expires_at,c.instagram_id)})),history,insights,intents,nextOffset:history.length===50?offset+50:null,livePublishing:false},{headers:metaHeaders});
}catch(e){return metaError(e);}}
export async function POST(request:Request){try{
 const {actor,org}=await metaIdentity(request);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Send JSON.'},{status:415,headers:metaHeaders});
 const raw=await request.text();if(raw.length>5000)throw new MetaError('meta_precondition_failed');
 let input:unknown;try{input=JSON.parse(raw);}catch{throw new MetaError('meta_precondition_failed');}
 const parsed=command.safeParse(input);if(!parsed.success)throw new MetaError('meta_precondition_failed');
 const p=parsed.data,service=metaService();
 if(p.action==='fingerprint'){
  const asset=await getRecord(org,'asset',p.assetId);
  if(!asset?.key||!asset.key.startsWith(org+'/')||!Number.isInteger(asset.size)||asset.size<=0||asset.size>40*1024*1024)throw new MetaError('meta_precondition_failed');
  const {data,error}=await (await bucket()).download(asset.key);
  if(error||!data||data.size!==asset.size)throw new MetaError('meta_precondition_failed');
  const sha256=createHash('sha256').update(Buffer.from(await data.arrayBuffer())).digest('hex');
  await service(actor,'fingerprint',{assetId:p.assetId,storageKey:asset.key,size:data.size,sha256});
  return Response.json({assetId:p.assetId,fingerprinted:true},{headers:metaHeaders});
 }
 if(p.action==='sync'||p.action==='disconnect'||p.action==='prepare'||p.action==='schedule')return Response.json(await service(actor,p.action==='sync'?'enqueue':p.action==='prepare'?'reserve':p.action==='schedule'?'schedule':'disconnect',p),{headers:metaHeaders});
 const config=configuration(),graph=new Graph(config),stored=await service(actor,'user-token',{});
 if(!stored?.ciphertext)throw new MetaError('meta_reconnect_required');
 const credential=unseal<UserCredential>(stored.ciphertext,config.key,`${org}:user:${actor}`);
 await graph.debug(credential.token);
 if(p.action==='pages'){
  const result=await graph.pages(credential.token,p.after);
  return Response.json({pages:result.data.map(x=>({id:x.id,name:x.name,tasks:x.tasks||[],instagram:x.instagram_business_account?{id:x.instagram_business_account.id,username:x.instagram_business_account.username||null}:null})),after:result.paging?.next?result.paging?.cursors?.after:null},{headers:metaHeaders});
 }
 // Re-fetch the selection server-side; never accept a Page token or IG account from a browser.
 const page=await graph.page(credential.token,p.pageId);if(page.id!==p.pageId||!page.access_token)throw new MetaError('meta_permission_missing');
 const checked=await graph.debug(page.access_token),scopes=await graph.permissions(credential.token);
 const expiresAt=checked.expires_at?new Date(checked.expires_at*1000).toISOString():null;
 const dataExpiresAt=checked.data_access_expires_at?new Date(checked.data_access_expires_at*1000).toISOString():credential.dataExpiresAt;
 await service(actor,'save-page',{pageId:page.id,name:page.name,instagramId:page.instagram_business_account?.id||null,instagramName:page.instagram_business_account?.username||null,tasks:page.tasks||[],scopes,expiresAt,dataExpiresAt,ciphertext:seal({pageToken:page.access_token,userToken:credential.token},config.key,`${org}:page:${page.id}`)});
 return Response.json({connected:true,pageId:page.id,diagnostics:diagnostics(scopes,page.tasks||[],expiresAt,dataExpiresAt,page.instagram_business_account?.id||null),livePublishing:false},{headers:metaHeaders});
}catch(e){return metaError(e);}}
