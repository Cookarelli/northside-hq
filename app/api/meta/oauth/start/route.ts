import {randomBytes} from 'node:crypto';
import {cookies} from 'next/headers';
import {configuration,hash,oauthURL} from '@/lib/meta/core';
import {metaIdentity,metaService,metaError,metaHeaders} from '@/lib/meta/server';
export const runtime='nodejs';
export async function POST(request:Request){try{
 const {actor}=await metaIdentity(request),config=configuration();
 if(new URL(request.url).origin!==new URL(config.redirectUri).origin)throw new Error('Forbidden');
 const state=randomBytes(32).toString('base64url');await metaService()(actor,'oauth-begin',{hash:hash(state)});
 (await cookies()).set('__Host-meta-state',state,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600});
 return Response.json({url:oauthURL(config,state)},{headers:metaHeaders});
}catch(e){return metaError(e);}}
