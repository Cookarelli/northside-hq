import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {auctionDb} from './helpers/auction-db.mjs';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
async function compile(path,replace={}){
 let source=await readFile(new URL('../'+path,import.meta.url),'utf8');
 source=source.replace(/from '([^']+)'/g,(_full,name)=>'from '+JSON.stringify(replace[name]||(name.startsWith('@/')?new URL('../'+name.slice(2)+'.ts',import.meta.url).href:import.meta.resolve(name))));
 return url(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
let fixture,route,workerRoute;
before(async()=>{
 fixture=await auctionDb();globalThis.__socialApiClient={auth:{getUser:async()=>({data:{user:{email_confirmed_at:'2026-01-01'}},error:null})},rpc:async(name,args={})=>{
  try{return {data:(await fixture.db.query(name==='hub_context'?'select hub_context() result':'select hub_social($1,$2::jsonb) result',name==='hub_context'?[]:[args.p_action,JSON.stringify(args.p_payload)])).rows[0].result,error:null};}catch(error){return {data:null,error};}
 }};
 const supabase=url('export async function sessionClient(){return globalThis.__socialApiClient;}');
 const storage=await compile('lib/storage.ts',{'./supabase':supabase});
 const agreements=url('export async function agreementGate(){return {required:false};}');
 route=await import(await compile('app/api/social/route.ts',{'@/lib/storage':storage,'@/lib/agreements':agreements}));
 workerRoute=await import(await compile('app/api/social/worker/route.ts'));
});
after(async()=>{await fixture.db.close();delete globalThis.__socialApiClient;});
function request(body,origin='https://hq.test'){return new Request('https://hq.test/api/social',{method:'POST',headers:{'content-type':'application/json',origin},body:typeof body==='string'?body:JSON.stringify(body)});}
test('social command route checks same-origin, input and real database role permissions',async()=>{
 await fixture.actor('steve');assert.equal((await route.POST(request({action:'resume',role:'scout'},'https://other.test'))).status,403);
 assert.equal((await route.POST(request('{'))).status,400);
 assert.equal((await route.POST(request({action:'run',role:'scout',requestId:'invalid'}))).status,400);
 await fixture.actor('jon');assert.equal((await route.POST(request({action:'resume',role:'scout'}))).status,403);
 await fixture.actor('steve');assert.equal((await route.POST(request({action:'resume',role:'scout'}))).status,200);
});
test('cron endpoint fails closed without a secret and stays disabled with valid authentication',async()=>{
 const saved={secret:process.env.CRON_SECRET,enabled:process.env.SOCIAL_WORKER_ENABLED};
 try{
  delete process.env.CRON_SECRET;
  assert.equal((await workerRoute.GET(new Request('https://hq.test/api/social/worker',{headers:{authorization:'Bearer undefined'}}))).status,401);
  process.env.CRON_SECRET='test-only-secret';process.env.SOCIAL_WORKER_ENABLED='false';
  assert.equal((await workerRoute.GET(new Request('https://hq.test/api/social/worker',{headers:{authorization:'Bearer wrong'}}))).status,401);
  const response=await workerRoute.GET(new Request('https://hq.test/api/social/worker',{headers:{authorization:'Bearer test-only-secret'}}));
  assert.deepEqual(await response.json(),{state:'disabled',processed:0});
 }finally{for(const [key,value] of [['CRON_SECRET',saved.secret],['SOCIAL_WORKER_ENABLED',saved.enabled]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
