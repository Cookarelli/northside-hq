import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import ts from 'typescript';
import {dailyBriefing} from '../lib/content-intelligence/briefing.ts';
import {performance,latestPosts,spendResults} from '../lib/content-intelligence/analytics.ts';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://hq.test/assets/research/intelligence'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {default:React,act}=await import('react');const {createRoot}=await import('react-dom/client');
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64'),react=import.meta.resolve('react');
const link=url(`import React from ${JSON.stringify(react)};export default function Link({children,...p}){return React.createElement('a',p,children)}`);
async function uiModule(name){const source=(await readFile(new URL('../components/ui/'+name+'.tsx',import.meta.url),'utf8')).replace(/from "([^"]+)"/g,(_,path)=>'from '+JSON.stringify(path.startsWith('@/')?new URL('../'+path.slice(2)+'.ts',import.meta.url).href:import.meta.resolve(path)));return url(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText);}
const button=await uiModule('button'),input=await uiModule('input');
const navigation=url(`import React from ${JSON.stringify(react)};export function useHqTab(){return globalThis.__intelTab||'briefing'}export function HqSubnavigation({tabs,active}){return React.createElement('nav',{className:'hq-subnavigation'},tabs.map(t=>React.createElement('a',{key:t.id,href:'?tab='+t.id,'aria-current':t.id===active?'page':undefined},t.label)))}`);
let source=await readFile(new URL('../components/content-intelligence.tsx',import.meta.url),'utf8');
const replacements={'react':react,'next/link':link,'@/components/ui/button':button,'@/components/ui/input':input,'@/components/hq-subnavigation':navigation};
source=source.replace("import './content-intelligence.css';",'').replace(/from '([^']+)'/g,(_,name)=>'from '+JSON.stringify(replacements[name]||(name.startsWith('@/')?new URL('../'+name.slice(2)+'.ts',import.meta.url).href:import.meta.resolve(name))));
const Component=(await import(url(`import React from ${JSON.stringify(react)};\n`+ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText))).default;
const now=new Date('2026-10-16T15:00:00Z');
const posts=Array.from({length:6},(_,i)=>({page_id:'123',platform:'instagram',external_id:String(i),caption:'Test-only source-led collector story '+(i+1),url:'https://www.instagram.com/p/fixture'+i,published_at:'2026-10-16T12:00:00Z',state:'published',media_type:i<3?'VIDEO':'IMAGE'}));
const snapshots=posts.map((p,i)=>({id:'s'+i,page_id:'123',platform:'instagram',subject_id:p.external_id,kind:'post',observed_at:now.toISOString(),metrics:{views:100+i*20,likes:8+i,comments:2,shares:i<3?10:2,saves:4,reach:80},unavailable:['impressions']}));
const measured=latestPosts(posts,snapshots,[],now),result=performance(measured,'2026-10-10','2026-10-16');
const report={id:'20000000-0000-4000-8000-000000000001',kind:'briefing',report_day:'2026-10-16',created_at:now.toISOString(),data:dailyBriefing(['Sports collectors: a community question','Pokemon collector conversation','New release checklist review'].map((title,i)=>({id:String(i),title,url:'https://ripped.topps.com/fixture-'+i,category:i===1?'Pokemon':'Baseball',kind:i===2?'release':'story',status:'new',priority:'high',verification:'unverified',published_at:'2026-10-15',summary:'Test-only editorial evidence',event_date:null})),{},[],[],now)};
const fixture={result,daily:result,weekly:result,reports:[report],connections:[{page_id:'123',name:'Northside test fixture',instagram_id:'456',status:'connected',last_sync_at:null}],runs:[],snapshots,campaigns:[],campaignLinks:[],reportingKeys:[],spend:spendResults([],'2026-10-10','2026-10-16'),truncated:false,admin:false,generatedAt:now.toISOString()};
async function mount(tab='briefing',data=fixture){
 globalThis.__intelTab=tab;const calls=[];globalThis.fetch=async(_url,options)=>{if(options?.method==='POST'){calls.push(JSON.parse(options.body));return Response.json({ok:true});}return Response.json(data);};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(React.createElement(Component)));await act(async()=>new Promise(r=>setTimeout(r,190)));return {host,root,calls};
}
test('briefing displays complete evidence and sends explicit draft-only calendar handoff',async()=>{
 const {host,root,calls}=await mount();assert.equal(host.querySelectorAll('.intelligence-idea').length,3);assert.match(host.textContent,/Published 2026-10-15/);assert.match(host.textContent,/America\/Chicago/);assert.match(host.textContent,/Facebook/);assert.match(host.textContent,/Instagram/);
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Add calendar draft'));await act(async()=>button.click());assert.equal(calls[0].action,'handoff');assert.equal(calls[0].calendar,true);assert.equal(calls.some(c=>c.action==='publish'),false);await act(async()=>root.unmount());host.remove();
});
test('performance keeps metric labels distinct and shows the real unavailable/ROI state',async()=>{
 const {host,root}=await mount('performance');for(const name of ['Views','Impressions','Likes','Reactions','Shares','Saves','Unavailable','Confirmed sales ROI unavailable'])assert.ok(host.textContent.includes(name));assert.match(host.textContent,/non-unique total/);await act(async()=>root.unmount());host.remove();
});
test('read-only staff cannot launch manual privileged sync; summaries expose evidence counts',async()=>{
 const {host,root}=await mount('sync');assert.ok([...host.querySelectorAll('button')].every(b=>b.disabled));await act(async()=>root.unmount());host.remove();
 const b=await mount('summaries');assert.match(b.host.textContent,/n=3/);assert.match(b.host.textContent,/Observation only/);await act(async()=>b.root.unmount());b.host.remove();
});
test('visual fixtures render actual view markup without live records or credentials',async()=>{
 if(!process.env.INTELLIGENCE_VISUAL_DIR)return;
 const directory=process.env.INTELLIGENCE_VISUAL_DIR;await mkdir(directory,{recursive:true});
 const styles=[];try{for(const file of await readdir(new URL('../.next/static/css/',import.meta.url)))if(file.endsWith('.css'))styles.push(await readFile(new URL('../.next/static/css/'+file,import.meta.url),'utf8'));}catch{}
 styles.push(await readFile(new URL('../components/content-intelligence.css',import.meta.url),'utf8'));
 for(const tab of ['briefing','performance','summaries','sync']){
  const {host,root}=await mount(tab);await writeFile(directory+'/'+tab+'.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles.join('\n')+'</style></head><body><div class="hub hq-shell"><header class="masthead hq-masthead"><img src="/northside-collectibles-blue.svg" alt="Northside Collectibles" width="206"><span>Local QA fixture</span></header><main class="workspace hq-workspace"><h1>Content intelligence</h1>'+host.innerHTML+'</main></div></body></html>');await act(async()=>root.unmount());host.remove();
 }
});
