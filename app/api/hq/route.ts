import {db,identity,apiError} from '@/lib/storage';
import {hqCommand} from '@/lib/hq-model';

const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request) {
  try {
    const workspace=await identity();
    const client=await db();
    const url=new URL(request.url), kind=url.searchParams.get('kind'), id=url.searchParams.get('id');
    if (kind==='activity' && !id) {
      const {data,error}=await client.from('hq_activity').select('id,actor,kind,record_id,action,created_at,snapshot').eq('org_id',workspace).in('kind',['project','deliverable','request']).order('created_at',{ascending:false}).order('id').limit(10);
      if(error) throw error;
      return Response.json({activity:(data||[]).map(item=>({...item,snapshot:{title:item.snapshot?.title}}))},{headers});
    }
    if (!kind && !id) {
      const {data,error}=await client.rpc('hub_hq',{p_action:'context',p_payload:{}});
      if(error) throw error;
      return Response.json(data,{headers});
    }
    const offset=Number(url.searchParams.get('offset')||0);
    if(kind==='spend'&&id&&Number.isSafeInteger(offset)&&offset>=0){const {data,error}=await client.rpc('hub_hq_operations',{p_action:'spend-list',p_payload:{projectId:id,offset}});if(error)throw error;return Response.json(data,{headers});}
    if(!['project','deliverable','request'].includes(kind||'') || !id || !Number.isSafeInteger(offset) || offset<0) return Response.json({error:'Choose a record and valid history page.'},{status:400,headers});
    const [{data:comments,error:commentsError},{data:activity,error:activityError}]=await Promise.all([
      client.from('hq_comments').select('*').eq('org_id',workspace).eq('kind',kind!).eq('record_id',id).order('created_at',{ascending:false}).order('id').range(offset,offset+24),
      kind==='project'
        ? client.from('hq_activity').select('*').eq('org_id',workspace).eq('project_id',id).order('created_at',{ascending:false}).order('id').range(offset,offset+24)
        : client.from('hq_activity').select('*').eq('org_id',workspace).eq('kind',kind!).eq('record_id',id).order('created_at',{ascending:false}).order('id').range(offset,offset+24),
    ]);
    if(commentsError||activityError) throw commentsError||activityError;
    return Response.json({comments,activity,nextOffset:comments.length===25||activity.length===25?offset+25:null},{headers});
  } catch(e) {return apiError(e);}
}
export async function POST(request:Request) {
  try {
    await identity(request);
    const raw=await request.text();
    if(Buffer.byteLength(raw)>150000) return Response.json({error:'This change is too large.'},{status:413,headers});
    let input:unknown; try {input=JSON.parse(raw);} catch {return Response.json({error:'Invalid request.'},{status:400,headers});}
    const parsed=hqCommand.safeParse(input);
    if(!parsed.success) return Response.json({error:parsed.error.issues[0]?.message||'Check the fields.'},{status:400,headers});
    const {action,...payload}=parsed.data;
    const {data,error}=await (await db()).rpc(action==='adopt-editorial'?'hub_hq_editorial':['reschedule','reminders','notification-read','spend','spend-reverse','comment'].includes(action)?'hub_hq_operations':'hub_hq',action==='adopt-editorial'?{p_payload:payload}:{p_action:action,p_payload:payload});
    if(error) {
      if(['42501','40001','22023','23514'].includes(error.code)) return Response.json({error:error.message},{status:error.code==='42501'?403:error.code==='40001'?409:400,headers});
      throw error;
    }
    return Response.json(data,{headers});
  } catch(e) {return apiError(e);}
}
