import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const storage=url('export async function db(){return globalThis.__intelligenceClient;}');
const radar=url(`export async function requireRadarStaff(request){if(!globalThis.__intelligenceStaff)throw Object.assign(new Error('Unauthorized'),{status:401});if(request.method!=='GET'&&request.headers.get('origin')!==new URL(request.url).origin)throw Object.assign(new Error('Forbidden'),{status:403});if(request.method!=='GET'&&!request.headers.get('content-type')?.startsWith('application/json'))throw Object.assign(new Error('Send JSON'),{status:415});return globalThis.__intelligenceStaff;};export function radarError(e){return Response.json({error:e.status?e.message:'Unavailable'},{status:e.status||503});}`);
const agreement=url('export async function agreementGate(){return {required:globalThis.__intelligenceAgreement};}');
const repository=url('export async function readIntelligence(){return {livePublishing:false,spendingEnabled:false,workersEnabled:false};}export async function generateReport(){return {ideas:[],notes:[]};}');
let source=await readFile(new URL('../app/api/content-intelligence/route.ts',import.meta.url),'utf8');
const replacements={'@/lib/storage':storage,'@/lib/content-radar/server':radar,'@/lib/agreements':agreement,'@/lib/content-intelligence/repository':repository};
source=source.replace(/from '([^']+)'/g,(_,name)=>'from '+JSON.stringify(replacements[name]||(name.startsWith('@/')?new URL('../'+name.slice(2)+'.ts',import.meta.url).href:import.meta.resolve(name))));
const route=await import(url(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText));
const request=(body,headers={})=>new Request('https://hq.test/api/content-intelligence',{method:'POST',headers:{origin:'https://hq.test','content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
test('API rejects anonymous, cross-origin, unsigned, malformed, oversized and staff sync requests',async()=>{
 globalThis.__intelligenceStaff=null;assert.equal((await route.GET(new Request('https://hq.test/api/content-intelligence'))).status,401);
 globalThis.__intelligenceStaff={orgId:'org',role:'staff',userId:'actor'};globalThis.__intelligenceClient={rpc:async()=>({data:{ok:true},error:null})};
 assert.equal((await route.POST(request({}, {origin:'https://evil.test'}))).status,403);
 globalThis.__intelligenceAgreement=true;assert.equal((await route.POST(request({}))).status,403);globalThis.__intelligenceAgreement=false;
 assert.equal((await route.POST(request('{'))).status,400);assert.equal((await route.POST(request('x'.repeat(12001)))).status,413);
 assert.equal((await route.POST(request({}, {'content-type':'text/plain'}))).status,415);
 assert.equal((await route.POST(request({action:'sync',pageId:'1',platform:'facebook',mode:'current'}))).status,403);
 assert.equal((await route.GET(new Request('https://hq.test/api/content-intelligence?from=2026-02-30'))).status,400);
});
test('report command only calls its scoped RPC; it cannot activate budgets, publishing or workers',async()=>{
 const calls=[];globalThis.__intelligenceClient={rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true},error:null};}};
 const response=await route.POST(request({action:'generate',kind:'briefing',requestId:crypto.randomUUID()}));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(calls[0].name,'hub_intelligence');assert.equal(calls[0].args.p_action,'report');assert.deepEqual(calls[0].args.p_payload.data.ideas,[]);
 for(const action of ['publish','spend','resume','deploy'])assert.equal((await route.POST(request({action}))).status,400);
});
