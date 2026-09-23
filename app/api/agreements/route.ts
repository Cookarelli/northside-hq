import {agreementGate} from '@/lib/agreements';
import {identity} from '@/lib/storage';
import {sessionClient} from '@/lib/supabase';
import {isIP} from 'node:net';
import {z} from 'zod';
import {agreementActionError} from '@/lib/agreement-action';

const bodySchema=z.object({
  action:z.literal('accept'),
  agreementId:z.string().uuid(),
  fullName:z.string().trim().min(2).max(200)
});

function sameOrigin(request:Request){
  const origin=request.headers.get('origin');
  return !!origin && origin===new URL(request.url).origin;
}

function forwardedIp(request:Request){
  const candidate=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'';
  return isIP(candidate)?candidate:'';
}

export async function GET(){
  try{
    await identity();
    return Response.json(await agreementGate(),{headers:{'Cache-Control':'private, no-store'}});
  }catch{
    return Response.json({error:'Unable to load agreement status.'},{status:403,headers:{'Cache-Control':'no-store'}});
  }
}

export async function POST(request:Request){
  try{
    await identity(request);
    if(!sameOrigin(request)) return Response.json({error:'Forbidden.'},{status:403});
    const parsed=bodySchema.safeParse(await request.json());
    if(!parsed.success) return Response.json({error:'Invalid agreement request.'},{status:400});
    const client=await sessionClient();

    const {data,error}=await client.rpc('hub_accept_agreement',{
      p_agreement_id:parsed.data.agreementId,
      p_full_name:parsed.data.fullName,
      p_ip:forwardedIp(request),
      p_user_agent:request.headers.get('user-agent')||''
    });
    if(error) throw error;
    if(!data?.ok || !data.acceptedAt) throw new Error('Incomplete agreement response');
    return Response.json(data,{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    const failure=agreementActionError(e);
    return Response.json({error:failure.error},{status:failure.status,headers:{'Cache-Control':'no-store'}});
  }
}
