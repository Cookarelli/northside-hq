import {db,identity,apiError} from '@/lib/storage';
import {agreementGate} from '@/lib/agreements';
import {command} from '@/lib/social/model';
const headers={'Cache-Control':'private, no-store'};
export async function GET() {
 try {
  const org=await identity(),client=await db();
  if((await agreementGate(client)).required)return Response.json({error:'Sign the staff agreement first.'},{status:403,headers});
  const queries=[
   client.rpc('hub_context'),
   client.rpc('hub_social_status'),
   client.from('social_tasks').select('id,role,stage,state,attempts,error_code,available_at,created_at').eq('org_id',org).order('created_at',{ascending:false}).limit(100),
   client.from('social_runs').select('id,task_id,status,started_at,finished_at,duration_ms,error_code').eq('org_id',org).order('started_at',{ascending:false}).limit(100),
   client.from('social_ideas').select('item_id,evidence,created_at').eq('org_id',org).order('created_at',{ascending:false}).limit(50),
   client.from('radar_editorial').select('id,version,data').eq('org_id',org).eq('kind','queue').in('data->>state',['Saved','Draft','Needs review','Approved']).order('updated_at',{ascending:false}).limit(100),
   client.from('social_reviews').select('id,queue_id,version,passed,checks,created_at').eq('org_id',org).order('created_at',{ascending:false}).limit(100),
   client.from('social_posts').select('id,queue_id,version,platform,state,scheduled_at,published_at').eq('org_id',org).order('scheduled_at',{ascending:false}).limit(100),
   client.from('social_analytics').select('id,post_id,observed_at,metrics,recommendations').eq('org_id',org).order('observed_at',{ascending:false}).limit(50),
   client.from('social_activity').select('id,actor,event,entity_id,created_at,details').eq('org_id',org).order('created_at',{ascending:false}).limit(50),
  ];
  const results=await Promise.all(queries);if(results.some(r=>r.error))throw new Error('Storage unavailable');
  const [context,agents,tasks,runs,ideas,drafts,reviews,posts,analytics,activity]=results.map(r=>r.data);
  return Response.json({role:context.role,agents,tasks,runs,ideas,drafts,reviews,posts,analytics,activity,livePublishing:false,workerConfigured:process.env.SOCIAL_WORKER_ENABLED==='true'&&!!process.env.CRON_SECRET&&!!process.env.SUPABASE_SERVICE_ROLE_KEY},{headers});
 }catch(error){return apiError(error);}
}
export async function POST(request:Request) {
 try {
  await identity(request);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Send JSON.'},{status:415,headers});
  const raw=await request.text();if(Buffer.byteLength(raw)>8000)return Response.json({error:'Request too large.'},{status:413,headers});
  let input:unknown;try{input=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON.'},{status:400,headers});}
  const parsed=command.safeParse(input);if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message||'Invalid command.'},{status:400,headers});
  const {action,...payload}=parsed.data;
  const {data,error}=await (await db()).rpc('hub_social',{p_action:action,p_payload:payload});
  if(error){if(['42501','40001','22023'].includes(error.code))return Response.json({error:error.message},{status:error.code==='42501'?403:error.code==='40001'?409:400,headers});throw error;}
  return Response.json(data,{headers});
 }catch(error){return apiError(error);}
}
