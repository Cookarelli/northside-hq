import type {SupabaseClient} from '@supabase/supabase-js';
import {check} from '../content-radar/database.ts';
import type {Staff} from '../content-radar/repository.ts';
import type {Item} from '../content-radar/model.ts';
import type {Detail,Product} from '../content-radar/editorial-model.ts';
import {latestPosts,performance,spendResults,type SpendRow} from './analytics.ts';
import {dailyBriefing,recommendationIdeas,type CalendarSlot} from './briefing.ts';
import {snapshotMetrics} from './sync.ts';
import {campaignKey,type Label,type Post,type Report,type Snapshot,type Template} from './model.ts';
import {chicagoWall} from '../consignment.ts';

// Stable keyset pagination prevents silently reading only Supabase's first 1,000 rows.
export async function readPages<T>(page:(after:string|null)=>PromiseLike<{data:T[]|null;error:{message:string;code?:string}|null}>,key:(r:T)=>string,maxPages=20){
 const rows:T[]=[];let after:string|null=null;
 for(let n=0;n<maxPages;n++){const r=await page(after);check(r.error);const batch=r.data||[];rows.push(...batch);if(batch.length<500)return {rows,truncated:false};const next=key(batch.at(-1)!);if(next===after)throw new Error('Invalid storage cursor');after=next;}
 return {rows,truncated:true};
}
async function readRanges<T>(page:(offset:number)=>PromiseLike<{data:T[]|null;error:{message:string;code?:string}|null}>){
 const rows:T[]=[];
 for(let offset=0;offset<10000;offset+=500){const result=await page(offset);check(result.error);rows.push(...result.data||[]);if((result.data?.length||0)<500)return {rows,truncated:false};}
 return {rows,truncated:true};
}
export async function readIntelligence(client:SupabaseClient,staff:Staff,range:{from:string;to:string;channel:string;category:string;campaign:string},now=new Date()){
 const w=staff.orgId;
 const postResult=await readRanges<Post>(offset=>client.from('intelligence_posts').select('page_id,platform,external_id,caption,url,published_at,media_type,state').eq('org_id',w).order('page_id').order('platform').order('account_id').order('external_id').range(offset,offset+499));
 const snapshots=await readPages<Snapshot&{format:string}>(after=>{let q=client.from('meta_analytics_snapshots').select('id,page_id,platform,subject_id,kind,observed_at,metrics,unavailable,format').eq('org_id',w).order('id').limit(500);if(after)q=q.gt('id',after);return q;},r=>r.id);
 const labels=await readRanges<Label>(offset=>client.from('intelligence_labels').select('*').eq('org_id',w).order('page_id').order('platform').order('external_id').range(offset,offset+499));
 const records=await readRanges<{kind:string;id:string;data:Record<string,unknown>}>(offset=>client.from('marketing_records').select('kind,id,data').eq('workspace_id',w).in('kind',['post','project','campaign','metrics','deliverable']).order('kind').order('id').range(offset,offset+499));
 const reports=await client.from('intelligence_reports').select('*').eq('org_id',w).order('created_at',{ascending:false}).limit(30);check(reports.error);
 const connections=await client.from('meta_connections').select('page_id,name,instagram_id,instagram_name,status,last_sync_at,error_code').eq('org_id',w).order('page_id').limit(100);check(connections.error);
 const runs=await client.from('intelligence_sync_runs').select('*').eq('org_id',w).order('started_at',{ascending:false}).limit(50);check(runs.error);
 const links=await client.from('intelligence_campaign_links').select('campaign_id,campaign_kind,reporting_key,version').eq('org_id',w).order('campaign_kind').order('campaign_id').limit(1000);check(links.error);
 const rows=records.rows,allSnapshots=snapshots.rows.map(s=>({...s,metrics:snapshotMetrics(s)}));
 const posts=latestPosts(postResult.rows,allSnapshots,labels.rows,now);
 const result=performance(posts,range.from,range.to,range),today=chicagoWall(now.getTime()).slice(0,10),week=new Date(Date.parse(today)-6*86400000).toISOString().slice(0,10);
 const calendar:CalendarSlot[]=rows.flatMap(r=>r.kind==='post'&&typeof r.data.date==='string'?[{date:r.data.date,title:String(r.data.title||''),recurrence:String(r.data.recurrence||'')}]:r.kind==='deliverable'&&typeof r.data.publishAt==='string'?[{date:r.data.publishAt,title:String(r.data.title||'')}]:[]);
 const truncated=snapshots.truncated||postResult.truncated||records.truncated||labels.truncated;
 if(truncated)result.recommendations=[];
 const selectedLink=links.data?.find(l=>campaignKey(l.campaign_kind,l.campaign_id)===range.campaign);
 const daily=performance(posts,today,today),weekly=performance(posts,week,today);
 if(truncated){daily.recommendations=[];weekly.recommendations=[];}
 return {range,result,daily,weekly,calendar,
  spend:spendResults(rows.filter(r=>r.kind==='metrics'&&(!range.campaign||selectedLink?.reporting_key)).flatMap(r=>typeof r.data.date==='string'&&typeof r.data.source==='string'&&typeof r.data.campaign==='string'&&(typeof r.data.spend==='string'||typeof r.data.spend==='number')?[{id:r.id,data:{date:r.data.date,source:r.data.source,campaign:r.data.campaign,spend:r.data.spend,...Object.fromEntries(['clicks','impressions','leads'].filter(k=>typeof r.data[k]==='number').map(k=>[k,r.data[k]]))}} as SpendRow]:[]),range.from,range.to,range.channel,range.campaign?selectedLink?.reporting_key||'':''),
  campaignLinks:(links.data||[]) as {campaign_id:string;campaign_kind:'project'|'campaign';reporting_key:string|null;version:number}[],reportingKeys:[...new Set(rows.filter(r=>r.kind==='metrics').map(r=>String(r.data.campaign||'')))].filter(Boolean),
  campaigns:rows.filter(r=>['project','campaign'].includes(r.kind)).map(r=>({id:r.id,kind:r.kind as 'project'|'campaign',name:String(r.data.title||r.data.name||r.id),auction:r.data.type==='weekly_auction'})),
  reports:reports.data as Report[],connections:connections.data||[],runs:runs.data||[],admin:staff.role==='admin',
  snapshots:allSnapshots.sort((a,b)=>b.observed_at.localeCompare(a.observed_at)).slice(0,200),
  truncated,
  generatedAt:now.toISOString(),livePublishing:false,spendingEnabled:false,workersEnabled:false,
 };
}
export type IntelligenceData=Awaited<ReturnType<typeof readIntelligence>>;
export async function generateReport(client:SupabaseClient,staff:Staff,kind:Report['kind'],now=new Date()){
 const today=chicagoWall(now.getTime()).slice(0,10);
 const data=await readIntelligence(client,staff,{from:today,to:today,channel:'all',category:'all',campaign:''},now);
 if(kind!=='briefing'){
  const summary=kind==='daily'?data.daily:data.weekly;
  const compact={from:summary.from,to:summary.to,prior:summary.prior,current:summary.current,previous:summary.previous,comparison:summary.comparison,postCount:summary.posts.length};
  return {ideas:data.truncated?[]:recommendationIdeas(summary.recommendations,data.calendar,now),summary:compact,notes:[summary.basis,...(data.truncated?['Coverage limit reached; recommendations withheld.']:[]),...(!summary.recommendations.length?['Insufficient comparable observations. At least three posts in each group and six per channel are required.']:[])]};
 }
 const items=await client.from('radar_items').select('*').eq('org_id',staff.orgId).neq('status','dismissed').order('collected_at',{ascending:false}).order('id').limit(1000);check(items.error);
 const editorial=await client.from('radar_editorial').select('id,kind,data').eq('org_id',staff.orgId).in('kind',['detail','product']).order('id').limit(1000);check(editorial.error);
 const config=await client.from('social_agents').select('config').eq('org_id',staff.orgId).eq('role','creator').maybeSingle();check(config.error);
 const details=Object.fromEntries((editorial.data||[]).filter(r=>r.kind==='detail').map(r=>[r.id,r.data as Detail]));
 const products=(editorial.data||[]).filter(r=>r.kind==='product').map(r=>r.data as Product);
 const preferred:Template=config.data?.config?.template==='collector-question'?'collector-question':'community-source';
 const result=dailyBriefing(items.data as Item[],details,products,data.calendar,now,preferred);
 if(data.truncated)result.notes.push('Calendar/reporting coverage limit reached; check the full calendar before saving a draft.');
 if(items.data?.length===1000||editorial.data?.length===1000)result.notes.push('Briefing considers the 1,000 latest research records; older evidence remains preserved.');
 return result;
}
