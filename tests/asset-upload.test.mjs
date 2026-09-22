import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {uploadAsset} from '../lib/asset-upload.ts';
import {assetProblem,publicBrandAssets} from '../lib/asset-policy.ts';
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original;});
const file=new File(['fictional'],'creative.png',{type:'image/png'});
const result={id:'asset',name:file.name,type:file.type,size:file.size};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('upload retry recovers a completed transfer without making a second file or ticket',async()=>{
 let ticket,tickets=0,transfers=0,finalizations=0;
 globalThis.fetch=async(url)=>{if(url==='/api/assets'){tickets++;return reply({id:'asset',signedUrl:'https://storage.example.test/upload'});}if(url==='/api/assets/finalize'){finalizations++;return finalizations===1?reply({error:'Temporary response failure'},503):reply({asset:result});}transfers++;return reply({});};
 await assert.rejects(uploadAsset(file,undefined,value=>{ticket=value;}),/Temporary/);
 assert.deepEqual(await uploadAsset(file,ticket,()=>assert.fail('second ticket')),result);assert.equal(tickets,1);assert.equal(transfers,1);assert.equal(finalizations,2);
});
test('failed transfer is visible and reuses its ticket when retried',async()=>{
 const ticket={id:'asset',signedUrl:'https://storage.example.test/upload'};let transferred=false;
 globalThis.fetch=async(url)=>url==='/api/assets/finalize'?reply({error:'Not found'},404):reply({error:'Unavailable'},503);
 await assert.rejects(uploadAsset(file,ticket,()=>assert.fail()),/transfer failed/);
 globalThis.fetch=async(url)=>{if(url==='/api/assets/finalize')return transferred?reply({asset:result}):reply({error:'Not found'},404);assert.equal(url,ticket.signedUrl);transferred=true;return reply({});};
 assert.deepEqual(await uploadAsset(file,ticket,()=>assert.fail()),result);
});
test('unsupported and oversized files fail before network access; public brand allowlist is explicit',async()=>{
 globalThis.fetch=()=>assert.fail('Unsupported files must not be uploaded');
 await assert.rejects(uploadAsset(new File(['unsafe'],'script.html',{type:'text/html'}),undefined,()=>{}),/JPG/);
 assert.match(assetProblem({type:'image/png',size:40*1024*1024+1}),/40 MB/);assert.deepEqual(publicBrandAssets,['/favicon.svg']);
});
