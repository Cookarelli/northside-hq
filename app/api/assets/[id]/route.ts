import {identity,bucket,getRecord,apiError} from '@/lib/storage';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const workspace=await identity(),{id}=await params;
  const record=await getRecord(workspace,'asset',id);
  if(!record)return Response.json({error:'Asset not found.'},{status:404});
  const {data,error}=await (await bucket()).createSignedUrl(record.key,300,(new URL(request.url).searchParams.get('download')==='1'||!['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm','application/pdf'].includes(record.type))?{download:record.name}:undefined);
  if(error)throw error;
  // Storage serves the bytes and range requests directly, outside Vercel's body limit.
  return new Response(null,{status:307,headers:{Location:data.signedUrl,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
 }catch(e){return apiError(e);}
}
