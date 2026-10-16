import {timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {drain,type Lease} from '@/lib/social/worker';
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET(request:Request) {
 const secret=process.env.CRON_SECRET;
 const incoming=Buffer.from(request.headers.get('authorization')||'');
 const expected=Buffer.from(`Bearer ${secret||''}`);
 if(!secret||incoming.length!==expected.length||!timingSafeEqual(incoming,expected))return Response.json({error:'Unauthorized'},{status:401,headers});
 if(process.env.SOCIAL_WORKER_ENABLED!=='true')return Response.json({state:'disabled',processed:0},{headers});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return Response.json({error:'Worker configuration required'},{status:503,headers});
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(7000)})}});
 async function rpc(name:string,args?:Record<string,unknown>){const {data,error}=await client.rpc(name,args);if(error)throw new Error('Worker storage unavailable');return data;}
 try {
  return Response.json(await drain({tick:async()=>{await rpc('hub_social_tick');},claim:async()=>await rpc('hub_social_claim') as Lease|null,execute:lease=>rpc('hub_social_execute',{p_org:lease.orgId,p_id:lease.id,p_token:lease.token})}),{headers});
 }catch{return Response.json({error:'Worker interrupted. Unfinished leases will recover automatically.'},{status:503,headers});}
}
