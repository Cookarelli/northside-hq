import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {db,identity} from '@/lib/storage';
import {agreementGate} from '@/lib/agreements';
import {MetaError} from './core';
export async function metaIdentity(request?:Request){
 const org=await identity(request),client=await db();
 const {data:{user},error}=await client.auth.getUser();
 const {data:context,error:contextError}=await client.rpc('hub_context');
 if(error||!user||contextError||context?.role!=='admin'||(await agreementGate(client)).required)throw new Error('Forbidden');
 return {org,actor:user.id,client};
}
export function metaService(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new MetaError('meta_configuration_required');
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(7000)})}});
 return async(actor:string,action:string,payload:Record<string,unknown>)=>{
  const {data,error}=await client.rpc('hub_meta_service',{p_actor:actor,p_action:action,p_payload:payload});
  if(error)throw new MetaError(error.code==='42501'?'meta_forbidden':error.code==='23505'?'meta_duplicate_blocked':error.code==='22023'?'meta_precondition_failed':'meta_storage_unavailable');
  return data;
 };
}
export const metaHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export function metaError(error:unknown){const code=error instanceof MetaError?error.code:error instanceof Error&&['Forbidden','Unauthorized'].includes(error.message)?error.message:'meta_unavailable';return Response.json({error:code,livePublishing:false},{status:code==='Unauthorized'?401:['Forbidden','meta_forbidden'].includes(code)?403:code==='meta_duplicate_blocked'?409:code==='meta_precondition_failed'?400:503,headers:metaHeaders});}
