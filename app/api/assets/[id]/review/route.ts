import {z} from 'zod';
import {db,identity,apiError} from '@/lib/storage';
const schema=z.object({version:z.number().int().min(0).max(99999999),action:z.enum(['approve','waiting']),deliverableId:z.string().max(180).default(''),note:z.string().trim().max(1000).default('')}).strict();
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  await identity(request);
  const {id}=await params,raw=await request.text();
  if(raw.length>4096||!id||id.length>180)return Response.json({error:'Invalid media review.'},{status:400,headers});
  let input;try{input=JSON.parse(raw);}catch{return Response.json({error:'Invalid media review.'},{status:400,headers});}
  const parsed=schema.safeParse(input);
  if(!parsed.success)return Response.json({error:'Choose Approve or Mark Waiting.'},{status:400,headers});
  const {data,error}=await (await db()).rpc('hub_review_media',{p_id:id,p_version:parsed.data.version,p_action:parsed.data.action,p_deliverable_id:parsed.data.deliverableId,p_note:parsed.data.note});
  if(error){if(['42501','40001','22023'].includes(error.code))return Response.json({error:error.message},{status:error.code==='42501'?403:error.code==='40001'?409:400,headers});throw error;}
  return Response.json(data,{headers});
 }catch(e){return apiError(e);}
}
