import {db,identity,apiError} from '@/lib/storage';
import {dailyProductionCommand,productionDay,templateDeliverable} from '@/lib/daily-production';
const headers={'Cache-Control':'private, no-store'};
async function run(action:string,payload:unknown){
 const {data,error}=await (await db()).rpc('hub_daily_production',{p_action:action,p_payload:payload});
 if(error){if(['42501','40001','22023','23514'].includes(error.code))return Response.json({error:error.message},{status:error.code==='42501'?403:error.code==='40001'?409:400,headers});throw error;}
 return Response.json(data,{headers});
}
export async function GET(request:Request){try{await identity();const u=new URL(request.url),day=productionDay.safeParse(u.searchParams.get('day')),offset=Number(u.searchParams.get('offset')||0);if(!day.success||!Number.isSafeInteger(offset)||offset<0||offset>100000)return Response.json({error:'Choose a date and valid page.'},{status:400,headers});return await run('list',{day:day.data,offset});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{
 await identity(request);const raw=await request.text();if(Buffer.byteLength(raw)>30000)return Response.json({error:'This change is too large.'},{status:413,headers});
 let input:unknown;try{input=JSON.parse(raw);}catch{return Response.json({error:'Invalid request.'},{status:400,headers});}
 const parsed=dailyProductionCommand.safeParse(input);if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message||'Check the fields.'},{status:400,headers});
 const {action,...payload}=parsed.data;return await run(action,action==='create'?{id:parsed.data.id,pillar:parsed.data.pillar,format:parsed.data.format,original:parsed.data.original,data:templateDeliverable(parsed.data)}:payload);
 }catch(e){return apiError(e);}}
