import {timingSafeEqual} from 'node:crypto';
import {cookies} from 'next/headers';
import {configuration,hash,seal,MetaError} from '@/lib/meta/core';
import {Graph} from '@/lib/meta/graph';
import {metaIdentity,metaService,metaError,metaHeaders} from '@/lib/meta/server';
export const runtime='nodejs';
export async function GET(request:Request){try{
 const {org,actor}=await metaIdentity(),config=configuration(),url=new URL(request.url),jar=await cookies();
 const state=url.searchParams.get('state')||'',cookie=jar.get('__Host-meta-state')?.value||'';
 jar.delete('__Host-meta-state');
 if(url.origin!==new URL(config.redirectUri).origin||!/^[A-Za-z0-9_-]{43}$/.test(state)||state.length!==cookie.length||!timingSafeEqual(Buffer.from(state),Buffer.from(cookie)))throw new Error('Forbidden');
 const service=metaService();await service(actor,'oauth-consume',{hash:hash(state)});
 const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code||code.length>4000)throw new MetaError('meta_oauth_cancelled');
 const graph=new Graph(config),token=await graph.exchange(code),check=await graph.debug(token.access_token),scopes=await graph.permissions(token.access_token);
 const expiresAt=check.expires_at?new Date(check.expires_at*1000).toISOString():token.expires_in?new Date(Date.now()+token.expires_in*1000).toISOString():null;
 const dataExpiresAt=check.data_access_expires_at?new Date(check.data_access_expires_at*1000).toISOString():null;
 await service(actor,'save-user',{ciphertext:seal({token:token.access_token,scopes,expiresAt,dataExpiresAt},config.key,`${org}:user:${actor}`),expiresAt});
 return new Response(null,{status:303,headers:{...metaHeaders,Location:new URL('/api/meta?connected=1',config.redirectUri).href}});
}catch(e){return metaError(e);}}
