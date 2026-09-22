import {agreementGate} from '@/lib/agreements';
import {identity} from '@/lib/storage';
import {sessionClient} from '@/lib/supabase';
import {z} from 'zod';

const bodySchema=z.object({
  action:z.literal('accept'),
  agreementId:z.string().uuid(),
  fullName:z.string().trim().min(2).max(200)
});

function sameOrigin(request:Request){
  const origin=request.headers.get('origin');
  return !!origin && origin===new URL(request.url).origin;
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

    const forwarded=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'';
    const ip=/^[0-9a-fA-F:.]+$/.test(forwarded)?forwarded:'';
    const {data,error}=await client.rpc('hub_accept_agreement',{
      p_agreement_id:parsed.data.agreementId,
      p_full_name:parsed.data.fullName,
      p_ip:ip,
      p_user_agent:request.headers.get('user-agent')||''
    });
    if(error) throw error;
    return Response.json(data,{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    const message=e instanceof Error?e.message:'Agreement action failed.';
    const safe=/full name|Agreement unavailable|must be provided/i.test(message)?message:'Could not save the agreement action.';
    return Response.json({error:safe},{status:400,headers:{'Cache-Control':'no-store'}});
  }
}
