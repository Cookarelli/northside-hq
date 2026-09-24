import {z} from 'zod';
import {db,identity,apiError} from '@/lib/storage';
const schema=z.object({version:z.number().int().min(0).max(99999999),projectId:z.string().max(180),deliverableId:z.string().max(180)}).strict();
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  await identity(request);
  const {id}=await params,raw=await request.text();
  if(raw.length>2048||!id||id.length>180)return Response.json({error:'Invalid assignment.'},{status:400,headers});
  let input;try{input=JSON.parse(raw);}catch{return Response.json({error:'Invalid assignment.'},{status:400,headers});}
  const parsed=schema.safeParse(input);
  if(!parsed.success)return Response.json({error:'Choose a project or deliverable.'},{status:400,headers});
  const {data,error}=await (await db()).rpc('hub_assign_asset',{p_id:id,p_version:parsed.data.version,p_project_id:parsed.data.projectId,p_deliverable_id:parsed.data.deliverableId});
  if(error){if(['42501','40001','22023'].includes(error.code))return Response.json({error:error.message},{status:error.code==='42501'?403:error.code==='40001'?409:400,headers});throw error;}
  return Response.json(data,{headers});
 }catch(e){return apiError(e);}
}
