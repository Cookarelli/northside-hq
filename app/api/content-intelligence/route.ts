import {createClient} from '@supabase/supabase-js';
import {db} from '@/lib/storage';
import {requireRadarStaff,radarError} from '@/lib/content-radar/server';
import {check,RadarError} from '@/lib/content-radar/database';
import {agreementGate} from '@/lib/agreements';
import {configuration,MetaError} from '@/lib/meta/core';
import {commandInput,rangeInput} from '@/lib/content-intelligence/model';
import {readIntelligence,generateReport} from '@/lib/content-intelligence/repository';
import {syncBatch} from '@/lib/content-intelligence/sync';
import {chicagoWall} from '@/lib/consignment';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
async function context(request:Request){const staff=await requireRadarStaff(request),client=await db();if((await agreementGate(client)).required)throw new RadarError(403,'Complete the staff agreement first.');return {staff,client};}
export async function GET(request:Request){try{
 const {staff,client}=await context(request),today=chicagoWall(Date.now()).slice(0,10);
 const range=rangeInput.safeParse({from:new Date(Date.parse(today)-6*86400000).toISOString().slice(0,10),to:today,...Object.fromEntries(new URL(request.url).searchParams)});
 if(!range.success)throw new RadarError(400,'Choose valid reporting dates and filters.');
 return Response.json(await readIntelligence(client,staff,range.data),{headers});
}catch(e){return radarError(e);}}
export async function POST(request:Request){try{
 const {staff,client}=await context(request),reader=request.body?.getReader();if(!reader)throw new RadarError(400,'Send a command.');
 const chunks:Uint8Array[]=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();throw new RadarError(413,'Request too large.');}chunks.push(value);}
 let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new RadarError(400,'Send valid JSON.');}
 const parsed=commandInput.safeParse(raw);if(!parsed.success)throw new RadarError(400,parsed.error.issues[0]?.message||'Invalid command.');const p=parsed.data;
 if(p.action==='sync'){
  if(staff.role!=='admin')throw new RadarError(403,'Only administrators synchronize Meta.');
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new RadarError(503,'Meta configuration required.');
  const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(7000)})}});
  const result=await syncBatch(p,async(action,payload)=>{const r=await service.rpc('hub_intelligence_sync',{p_actor:staff.userId,p_action:action,p_payload:payload});if(r.error)throw new MetaError('meta_storage_unavailable');return r.data;},configuration());
  return Response.json(result,{headers});
 }
 const payload=p.action==='generate'?{id:p.requestId,kind:p.kind,data:await generateReport(client,staff,p.kind)}:p;
 const r=await client.rpc('hub_intelligence',{p_action:p.action==='generate'?'report':p.action,p_payload:payload});check(r.error);
 return Response.json(r.data,{headers});
}catch(e){if(e instanceof MetaError)return Response.json({error:e.code},{status:503,headers});return radarError(e);}}
