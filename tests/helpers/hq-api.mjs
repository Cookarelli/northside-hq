// Real HQ route and storage identity checks; only the Supabase transport is replaced.
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
export async function hqApi(f){
 let signedIn=true;
 const client={auth:{getUser:async()=>({data:{user:signedIn?{email_confirmed_at:'2026-09-01'}:null},error:null})},rpc:async(name,args={})=>{
  const values=name==='hub_context'?[]:[args.p_action,args.p_payload];
  try{return {data:(await f.db.query(`select ${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result,error:null};}catch(error){return {data:null,error};}
 }};
 const key='__hq_route_'+crypto.randomUUID().replaceAll('-','');globalThis[key]=client;
 const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
 async function compile(path,replace={}){
  let source=await readFile(new URL('../../'+path,import.meta.url),'utf8');
  source=source.replace(/from '([^']+)'/g,(full,name)=>'from '+JSON.stringify(replace[name]|| (name.startsWith('@/')?new URL('../../'+name.slice(2)+'.ts',import.meta.url).href:import.meta.resolve(name))));
  return url(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 const supabase=url(`export async function sessionClient(){return globalThis[${JSON.stringify(key)}]}`);
 const storage=await compile('lib/storage.ts',{'./supabase':supabase});
 const route=await import(await compile('app/api/hq/route.ts',{'@/lib/storage':storage}));
 return {signedIn(value){signedIn=value;},close(){delete globalThis[key];},async post(body,origin='https://hq.example.test'){
  const response=await route.POST(new Request('https://hq.example.test/api/hq',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};
 }};
}
