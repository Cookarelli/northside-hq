import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServerClient} from '@supabase/ssr';
import {authLandingDestination} from '../lib/auth-landing.ts';
import {preparePasswordReset,saveNewPassword} from '../lib/password-recovery.ts';

test('dashboard reset fragment at root establishes a cookie session, opens reset, and saves a new password',async()=>{
  const cookies=new Map();const calls=[];let clean=false;
  const user={id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',email:'fixture@example.test',email_confirmed_at:'2026-09-01T00:00:00Z',created_at:'2026-09-01T00:00:00Z',app_metadata:{},user_metadata:{}};
  const payload={sub:user.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
  const accessToken=`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fixture`;
  const make=()=>createServerClient('https://auth.example.test','synthetic-public-key',{
    cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(({name,value,options})=>options.maxAge===0?cookies.delete(name):cookies.set(name,value))},
    global:{fetch:async(url,init={})=>{
      assert.ok(clean,'credentials must leave address bar before auth calls');
      const path=new URL(url).pathname;calls.push({path,method:init.method,body:init.body?JSON.parse(init.body):null});
      if(path.endsWith('/user'))return Response.json(user);
      if(path.endsWith('/logout'))return Response.json({});
      assert.fail('No second exchange of the single-use email link is needed');
    }},
  });
  const destination=await authLandingDestination(`https://www.northsidebrand.com/#access_token=${accessToken}&refresh_token=synthetic-refresh&type=recovery`,()=>{clean=true;},()=>make().auth);
  assert.equal(destination,'/reset-password');
  assert.ok(cookies.size>0);
  const resetClient=make();
  assert.equal(await preparePasswordReset(resetClient.auth,'https://www.northsidebrand.com/reset-password',()=>{}),user.email);
  assert.match(await saveNewPassword(resetClient.auth,'Synthetic-password-123!','Synthetic-password-123!'),/updated/);
  assert.ok(calls.some(call=>call.path.endsWith('/user')&&call.method==='PUT'));
  assert.ok(calls.some(call=>call.path.endsWith('/logout')));
});

test('expired, incomplete, or rejected recovery fragments never enter HQ or reuse another session',async()=>{
  for(const hash of ['#error=access_denied&error_code=otp_expired','#type=recovery&access_token=missing-refresh','#type=recovery&access_token=invalid&refresh_token=invalid']) {
    let cleared=false;
    const auth={setSession:async()=>({error:{message:'invalid'}}),getUser:()=>assert.fail('must not use another session')};
    assert.equal(await authLandingDestination('https://www.northsidebrand.com/'+hash,()=>{cleared=true;},()=>auth),'/reset-password?error=invalid-link');
    assert.ok(cleared);
  }
});

test('ordinary homepage visits still go to Today, ignoring external destinations',async()=>{
  let cleared=false;
  assert.equal(await authLandingDestination('https://www.northsidebrand.com/?next=https://evil.example#other',()=>{cleared=true;},()=>assert.fail('no recovery client needed')),'/today');
  assert.ok(cleared);
});

test('explicit PKCE recovery flow ID survives removal of the browser URL',async()=>{
  let clean=false;const calls=[];
  const auth={exchangeCodeForSession:async(...args)=>{assert.ok(clean);calls.push(args);return {error:null};},getUser:async()=>({data:{user:{email:'fixture@example.test',email_confirmed_at:'2026-09-01'}},error:null})};
  await preparePasswordReset(auth,'https://www.northsidebrand.com/reset-password?code=synthetic&sb_flow_id=flow',()=>{clean=true;});
  assert.deepEqual(calls,[['synthetic',{flowId:'flow'}]]);
});
