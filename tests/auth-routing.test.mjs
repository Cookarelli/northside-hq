import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServerClient} from '@supabase/ssr';
import {authCallbackDestination, postLoginDestination, legacyAuthCallback, authErrorMessage} from '../lib/auth-routing.ts';

const user = {id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',email:'staff@example.test',email_confirmed_at:'2026-09-01T00:00:00Z',created_at:'2026-09-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const json = (body, status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const signed = async () => ({required:false});
const unsigned = async () => ({required:true,hardGate:true,agreementId:'document',storagePath:'document.pdf'});
function fixture({authorized=true, verified=true, rejected=false, recovery=false}={}) {
  const cookies = new Map();
  const writes = [];
  const calls = [];
  const currentUser = {...user,email_confirmed_at:verified ? user.email_confirmed_at : null};
  const payload = {sub:user.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
  const access_token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fixture`;
  const transport = async (url,init={}) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if(path.endsWith('/recover')) return json({});
    if(path.endsWith('/token')) {
      const body=JSON.parse(init.body);
      assert.equal(body.auth_code,'fixture-code');
      assert.ok(body.code_verifier.length>20);
      if(rejected) return json({code:'otp_expired',msg:'do-not-leak-provider-details'},400);
      return json({access_token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:currentUser});
    }
    if(path.endsWith('/user')) return json(currentUser);
    if(path.endsWith('/hub_context')) return json({orgId:authorized?'hq':null,userId:user.id});
    throw new Error(`Unexpected fixture endpoint ${path}`);
  };
  const makeClient = () => createServerClient('https://auth.example.test','fixture-public-key',{
    global:{fetch:transport},
    cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>{
      writes.push(...items);
      for(const {name,value,options} of items) options.maxAge===0 ? cookies.delete(name) : cookies.set(name,value);
    }},
  });
  const prepare = async () => {
    // Use the actual SDK to create cookie-backed PKCE state for each flow.
    const client = makeClient();
    if(recovery) await client.auth.resetPasswordForEmail(user.email,{redirectTo:'https://hq.example.test/auth/callback'});
    else await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:'https://hq.example.test/auth/callback',skipBrowserRedirect:true}});
  };
  return {makeClient,prepare,cookies,writes,calls};
}

for(const [name,gate,destination] of [
  ['accepted employee',signed,'/today'],
  ['unsigned employee',unsigned,'/agreements/required'],
  ['newly provisioned employee',unsigned,'/agreements/required'],
]) {
  test(`real SSR SDK: ${name} exchanges PKCE and keeps session across requests`,async()=>{
    const f=fixture(); await f.prepare();
    assert.equal(await authCallbackDestination(f.makeClient(),new URLSearchParams('code=fixture-code&next=https://evil.example'),gate),destination);
    assert.ok(f.writes.some(cookie=>cookie.name.includes('auth-token')&&!cookie.name.includes('code-verifier')&&cookie.options.maxAge>0));
    assert.equal(await postLoginDestination(f.makeClient(),gate),destination);
    assert.equal(f.calls.filter(path=>path.endsWith('/token')).length,1);
  });
}

test('real SSR SDK rejects expired/reused codes and missing verifier without reaching NDA checks',async()=>{
  const f=fixture({rejected:true}); await f.prepare();
  const gate=async()=>assert.fail('failed auth cannot proceed to gate');
  assert.equal(await authCallbackDestination(f.makeClient(),new URLSearchParams('code=fixture-code'),gate),'/login?auth=invalid-link');
  assert.equal(await authCallbackDestination(f.makeClient(),new URLSearchParams('code=fixture-code'),gate),'/login?auth=invalid-link');
  assert.equal(f.calls.filter(path=>path.endsWith('/token')).length,2);
  const fresh=fixture();
  assert.equal(await authCallbackDestination(fresh.makeClient(),new URLSearchParams('code=fixture-code'),gate),'/login?auth=invalid-link');
  assert.equal(fresh.calls.length,0);
  assert.ok(!f.calls.some(path=>path.endsWith('/hub_context')));
});

test('real SSR SDK recovery callback keeps recovery destination even through the legacy root URL',async()=>{
  const f=fixture({recovery:true}); await f.prepare();
  const legacy=new URL(legacyAuthCallback(new URLSearchParams('code=fixture-code')),'https://hq.example.test');
  assert.equal(await authCallbackDestination(f.makeClient(),legacy.searchParams,signed),'/reset-password');
});

test('unapproved and unverified users cannot reach HQ even with a valid auth code',async()=>{
  for(const [options,expected] of [[{authorized:false},'/login?auth=access-denied'],[{verified:false},'/login?auth=invalid-link']]) {
    const f=fixture(options); await f.prepare();
    assert.equal(await authCallbackDestination(f.makeClient(),new URLSearchParams('code=fixture-code'),async()=>assert.fail('not authorized')),expected);
  }
});

test('missing, malformed, duplicated, and error codes fail closed without exchanging or trusting a prior session',async()=>{
  const client={auth:{exchangeCodeForSession:()=>assert.fail('must not exchange'),getUser:()=>assert.fail('must not use old session')}};
  for(const query of ['', 'code=', 'error=access_denied&code=fixture-code','code=a&code=b','code=a&token_hash=b','token_hash=a&type=sms',`code=${'a'.repeat(2049)}`]) {
    assert.equal(await authCallbackDestination(client,new URLSearchParams(query),signed),'/login?auth=invalid-link');
  }
});

test('callback preserves explicit PKCE flow ID and verifies invite/email tokens using the provider',async()=>{
  const seen=[];
  const client={
    auth:{exchangeCodeForSession:async(code,options)=>{seen.push([code,options]);return {data:{session:{}},error:null};},verifyOtp:async(input)=>{seen.push(input);return {data:{session:{}},error:null};},getUser:async()=>({data:{user},error:null})},
    rpc:async()=>({data:{orgId:'hq',userId:user.id},error:null}),
  };
  assert.equal(await authCallbackDestination(client,new URLSearchParams('code=fixture&sb_flow_id=explicit-flow'),signed),'/today');
  assert.deepEqual(seen.shift(),['fixture',{flowId:'explicit-flow'}]);
  for(const type of ['email','signup','invite','email_change','recovery']) {
    assert.equal(await authCallbackDestination(client,new URLSearchParams(`token_hash=fixture&type=${type}`),unsigned),type==='recovery'?'/reset-password':'/agreements/required');
    assert.deepEqual(seen.shift(),{token_hash:'fixture',type});
  }
});

test('agreement service failure routes to the locked agreement screen; logged-out session goes to login',async()=>{
  const f=fixture();await f.prepare();
  assert.equal(await authCallbackDestination(f.makeClient(),new URLSearchParams('code=fixture-code'),async()=>{throw new Error('offline');}),'/agreements/required');
  assert.equal(await postLoginDestination(fixture().makeClient(),signed),'/login?auth=invalid-link');
});

test('legacy handler uses the same callback, preserves flow ID, and discards external redirects and raw error detail',()=>{
  assert.equal(legacyAuthCallback(new URLSearchParams('code=fixture&sb_flow_id=flow&next=https://evil.example')), '/auth/callback?code=fixture&sb_flow_id=flow');
  assert.equal(legacyAuthCallback(new URLSearchParams('error=expired&error_description=private')), '/auth/callback?error=expired');
  assert.equal(legacyAuthCallback(new URLSearchParams('next=/today')),null);
  assert.equal(authErrorMessage('private-provider-error'),'');
  assert.equal(authErrorMessage(['invalid-link']),'');
  assert.match(authErrorMessage('invalid-link'),/same browser/);
});
