import {identity,bucket,saveRecord,apiError} from '@/lib/storage';
import {z} from 'zod';
import {supportedAssetTypes,assetSizeLimit} from '@/lib/asset-policy';
const schema=z.object({name:z.string().min(1).max(250),type:z.enum(supportedAssetTypes),size:z.number().int().positive().max(assetSizeLimit),collection:z.literal('jons-content').optional(),title:z.string().trim().max(250).optional(),note:z.string().trim().max(500).optional()}).strict();
export async function POST(request:Request){
 try {
  const workspace=await identity(request);
  const raw=await request.text();if(raw.length>4096)return Response.json({error:'Invalid upload request.'},{status:413});
  let json;try{json=JSON.parse(raw);}catch{return Response.json({error:'Invalid upload request.'},{status:400});}
  const result=schema.safeParse(json);if(!result.success)return Response.json({error:'Use a supported image, video, graphic or document up to 40 MB.'},{status:400});
  const id=crypto.randomUUID(),key=workspace+'/'+id;
  const {data,error}=await (await bucket()).createSignedUploadUrl(key,{upsert:false});if(error)throw error;
  await saveRecord(workspace,'upload',id,{...result.data,id,key,createdAt:new Date().toISOString()});
  return Response.json({id,signedUrl:data.signedUrl},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiError(e);}
}
