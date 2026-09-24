import {identity,bucket,getRecord,saveRecord,apiError} from '@/lib/storage';
export async function POST(request:Request){
 try {
  const workspace=await identity(request);
  const raw=await request.text();if(raw.length>1024)return Response.json({error:'Invalid upload ID.'},{status:400});
  let id;try{id=JSON.parse(raw).id;}catch{return Response.json({error:'Invalid upload ID.'},{status:400});}
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))return Response.json({error:'Invalid upload ID.'},{status:400});
  const pending=await getRecord(workspace,'upload',id);
  if(!pending)return Response.json({error:'Upload not found.'},{status:404});
  const {data,error}=await (await bucket()).info(pending.key);if(error)throw error;
  if(data.size!==pending.size||data.contentType!==pending.type)return Response.json({error:'The uploaded file does not match the requested size or type. Please upload it again.'},{status:400});
  // Idempotent: a repeat after a network failure preserves the same asset ID.
  await saveRecord(workspace,'asset',id,pending);
  return Response.json({asset:await getRecord(workspace,'asset',id)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiError(e);}
}
