import {check,type Database} from './database.ts';
import {RadarError,type Staff} from './repository.ts';
import {editCommand,schemas,rankStory,type Product,type Detail,type RecordRow} from './editorial-model.ts';
export async function readEditorial(db:Database,s:Staff){
 const client=await db;
 const [records,items,history,assets,last,team,hq]=await Promise.all([
  client.from('radar_editorial').select('id,kind,data,version,updated_at').eq('org_id',s.orgId).order('updated_at',{ascending:false}).limit(1000),
  client.from('radar_items').select('id,title,url,summary,kind,published_at,event_date,status,collected_at').eq('org_id',s.orgId).neq('status','dismissed').order('collected_at',{ascending:false}).limit(1000),
  client.from('radar_editorial_history').select('*').eq('org_id',s.orgId).order('created_at',{ascending:false}).limit(500),
  client.from('marketing_records').select('id,data').eq('workspace_id',s.orgId).eq('kind','asset').order('updated_at',{ascending:false}).limit(200),
  client.from('radar_sources').select('last_success').eq('org_id',s.orgId).not('last_success','is',null).order('last_success',{ascending:false}).limit(1),
  client.rpc('hub_team'),
  client.from('marketing_records').select('id,data').eq('workspace_id',s.orgId).eq('kind','deliverable').limit(1000),
 ]);
 for(const result of [records,items,history,assets,last,team,hq])check(result.error);
 const rows=[...(records.data||[]),...(team.data||[])] as (Omit<RecordRow,'data'>&{data:Record<string,unknown>})[];
 const products=rows.filter(r=>r.kind==='product').map(r=>r.data as Product);
 const ranked=(items.data||[]).map(i=>({...i,...rankStory(i,rows.find(r=>r.kind==='detail'&&r.id===i.id)?.data as Detail|undefined,products)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 return {handoffs:Object.fromEntries((hq.data||[]).filter(r=>r.data.legacyEditorialId).map(r=>[r.data.legacyEditorialId,r.id])) as Record<string,string>,lastRefresh:last.data?.[0]?.last_success||null,jobs:[] as {id:string;data:{status:string};updated_at:string}[],records:rows,items:ranked,top5:ranked.slice(0,5),history:history.data||[],admin:s.role==='admin',userId:s.userId,
  assets:(assets.data||[]).map(a=>({id:a.id,name:a.data.name})),rankingScope:'Up to 1,000 most recently collected, non-dismissed stories. Scores recalculate on load; unknown dates receive no recency points.',
  ai:{connected:false,message:'Manual Facebook, Instagram and Reel drafting is available. AI generation is not connected.'},shopify:{connected:false}};
}
export async function saveEditorial(db:Database,_s:Staff,input:unknown){
 const parsed=editCommand.safeParse(input);if(!parsed.success)throw new RadarError(400,'Invalid editorial request.');
 const c=parsed.data,result=schemas[c.kind].safeParse(c.data);if(!result.success)throw new RadarError(400,result.error.issues[0]?.message||'Check the fields.');
 const response=await (await db).rpc('hub_editorial_save',{p_kind:c.kind,p_id:c.id,p_version:c.version,p_data:result.data});check(response.error);return response.data;
}
export async function addToCalendar(db:Database,_s:Staff,id:string){const r=await (await db).rpc('hub_calendar',{p_id:id});check(r.error);return r.data;}
