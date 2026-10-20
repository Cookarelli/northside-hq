import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {auctionDb} from './helpers/auction-db.mjs';
let f,route,clientKey,signedIn=true;
const dataUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
before(async()=>{
 f=await auctionDb();await f.actor('steve');
 const client={auth:{getUser:async()=>({data:{user:signedIn?{email_confirmed_at:'2026-09-01'}:null},error:null})},rpc:async(name,args={})=>{
  try{const values=name==='hub_context'?[]:[args.p_action,JSON.stringify(args.p_payload)];return {data:(await f.db.query(`select ${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result,error:null};}catch(error){return {data:null,error};}
 }};
 const key='__daily_api_'+crypto.randomUUID().replaceAll('-','');clientKey=key;globalThis[key]=client;
 async function compile(path,replace={}){let source=await readFile(new URL('../'+path,import.meta.url),'utf8');source=source.replace(/from '([^']+)'/g,(_,name)=>'from '+JSON.stringify(replace[name]||(name.startsWith('@/')?new URL('../'+name.slice(2)+'.ts',import.meta.url).href:import.meta.resolve(name))));return dataUrl(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
 const session=dataUrl(`export async function sessionClient(){return globalThis[${JSON.stringify(key)}]}`),storage=await compile('lib/storage.ts',{'./supabase':session});
 route=await import(await compile('app/api/daily-production/route.ts',{'@/lib/storage':storage}));
});
after(async()=>{delete globalThis[clientKey];await f?.db.close();});
const base='https://hq.example.test/api/daily-production';
async function post(body,origin='https://hq.example.test'){const r=await route.POST(new Request(base,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}
const draft=id=>({action:'create',id,pillar:'The Hobby Report',format:'carousel',original:true,title:'Synthetic API draft',owner:'jon',approver:'steve',publisher:'brody',productionDue:'2026-10-20T09:00',publishAt:'2026-10-20T12:00',platforms:['facebook','instagram']});

test('route validates auth, origin, payload, URL fields and body size before writes',async()=>{
 signedIn=false;assert.equal((await post(draft('anonymous'))).status,401);signedIn=true;
 assert.equal((await post(draft('cross-origin'),'https://other.example.test')).status,403);
 assert.equal((await post('{broken')).status,400);assert.equal((await post(' '.repeat(30001))).status,413);
 assert.equal((await post({...draft('spoof'),approval:{by:'steve'}})).status,400);
 assert.equal((await post({...draft('invalid-pillar'),pillar:'Made up'})).status,400);
});

test('route creates and reads canonical drafts; empty optional Story URLs are valid and invalid URLs return 400',async()=>{
 assert.equal((await post(draft('api-original'))).status,200);assert.equal((await post(draft('api-original'))).body.existing,true);
 const d=await f.get('api-original');assert.equal(d.status,'to_do');assert.equal(d.format,'Carousel');assert.equal(d.approval,null);
 const story={action:'story',id:'api-original',version:1,recordVersion:d.version,platform:'facebook',status:'planned',time:'',url:'',unavailableReason:'',confirmed:true};
 assert.equal((await post(story)).status,200);
 assert.equal((await post({...story,version:2,url:'invalid'})).status,400);
 const unpublished=await post({...story,version:2,status:'published',time:'2026-10-20T00:01',unavailableReason:'Ephemeral Story'});assert.equal(unpublished.status,400);assert.match(unpublished.body.error,/published original/);
 const stale=await post(story);assert.equal(stale.status,409);
 const response=await route.GET(new Request(base+'?day=2026-10-20'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');const page=await response.json();assert.ok(page.content.some(c=>c.deliverable_id==='api-original'));assert.equal(page.metrics.length,0);
 for(const q of ['day=2026-02-30','day=2026-10-20&offset=-1','day=bad'])assert.equal((await route.GET(new Request(base+'?'+q))).status,400);
});

test('route pagination retains all daily classifications without duplicate originals',async()=>{
 for(let i=0;i<51;i++)assert.equal((await post(draft('page-'+String(i).padStart(3,'0')))).status,200);
 const first=await (await route.GET(new Request(base+'?day=2026-10-20&offset=0'))).json(),last=await (await route.GET(new Request(base+'?day=2026-10-20&offset='+first.nextOffset))).json();
 assert.equal(first.content.length,50);assert.equal(first.nextOffset,50);assert.equal(last.nextOffset,null);assert.equal(new Set([...first.content,...last.content].map(c=>c.deliverable_id)).size,52);
});
