// Exercise the real route handlers and storage authorization, substituting only
// the Supabase transport. All RPCs and row reads run against the migrated DB.
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
export async function mediaApi(f){
 let signedIn=true;
 const client={
  auth:{getUser:async()=>({data:{user:signedIn?{email_confirmed_at:'2026-09-01'}:null},error:null})},
  rpc:async(name,args={})=>{
   const values=name==='hub_context'?[]:name==='hub_save_record'?[args.p_kind,args.p_id,args.p_data]:[args.p_id,args.p_version,args.p_action,args.p_deliverable_id,args.p_note];
   try{return {data:(await f.db.query(`select ${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result,error:null};}catch(error){return {data:null,error};}
  },
  from:()=>{
   const filters={};const query={select:()=>query,eq:(name,value)=>{filters[name]=value;return query;},maybeSingle:async()=>{try{return {data:(await f.db.query('select data from marketing_records where workspace_id=$1 and kind=$2 and id=$3',[filters.workspace_id,filters.kind,filters.id])).rows[0]||null,error:null};}catch(error){return {data:null,error};}}};return query;
  },
  storage:{from:()=>({createSignedUploadUrl:async(key,options)=>{if(options.upsert!==false)throw Error('Assets must remain immutable');return {data:{signedUrl:'https://storage.example.test/'+key},error:null};},info:async key=>{const row=(await f.db.query("select metadata from storage.objects where bucket_id='marketing-assets' and name=$1",[key])).rows[0];return row?{data:{size:row.metadata.size,contentType:row.metadata.mimetype},error:null}:{data:null,error:Error('Incomplete upload')};}})}
 };
 const key='__media_route_transport_'+crypto.randomUUID().replaceAll('-','');globalThis[key]=client;
 const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
 async function compile(path,replacements){let source=await readFile(new URL('../../'+path,import.meta.url),'utf8');for(const [from,to] of Object.entries(replacements))source=source.replaceAll("'"+from+"'",JSON.stringify(to));return url(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
 const supabase=url(`export async function sessionClient(){return globalThis[${JSON.stringify(key)}]}`);
 const storage=await compile('lib/storage.ts',{'./supabase':supabase});
 const policy=await compile('lib/asset-policy.ts',{});
 const replacements={'@/lib/storage':storage,'@/lib/asset-policy':policy,zod:import.meta.resolve('zod')};
 const upload=await import(await compile('app/api/assets/route.ts',replacements));
 const finalize=await import(await compile('app/api/assets/finalize/route.ts',replacements));
 const review=await import(await compile('app/api/assets/[id]/review/route.ts',replacements));
 return {signedIn(value){signedIn=value;},close(){delete globalThis[key];},async post(kind,body,id='asset',origin='https://hq.example.test'){
  const request=new Request('https://hq.example.test/api/assets'+(kind==='review'?'/'+id+'/review':kind==='finalize'?'/finalize':''),{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await ({upload,finalize,review})[kind].POST(request,{params:Promise.resolve({id})});return {status:response.status,body:await response.json()};
 }};
}
