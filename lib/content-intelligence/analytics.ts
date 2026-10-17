import {chicagoWall} from '../consignment.ts';
import {campaignKey,metricNames,type MetricName,type Metrics,type Snapshot,type Post,type Label} from './model.ts';

export type MeasuredPost = Post & {label:Label|null;snapshot:Snapshot|null};
export type Total = {value:number|null;covered:number;posts:number};
export type Totals = Record<MetricName,Total>;
export type Recommendation = {dimension:'format'|'category'|'schedule'|'template';value:string;platform:string;metric:MetricName;average:number;baseline:number;sample:number;baselineSample:number;post:MeasuredPost};
export type SpendRow = {id:string;data:{date:string;source:string;campaign:string;spend:number|string;impressions?:number;clicks?:number;leads?:number}};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function latestPosts(posts:Post[],snapshots:Snapshot[],labels:Label[],asOf=new Date()):MeasuredPost[]{
 const key=(p:{page_id:string;platform:string;external_id?:string;subject_id?:string})=>JSON.stringify([p.page_id,p.platform,p.external_id||p.subject_id]);
 const latest=new Map<string,Snapshot>();
 for(const s of snapshots){if(s.kind!=='post'||Date.parse(s.observed_at)>asOf.getTime())continue;const previous=latest.get(key(s));if(!previous||s.observed_at>previous.observed_at||s.observed_at===previous.observed_at&&s.id>previous.id)latest.set(key(s),s);}
 const annotations=new Map(labels.map(l=>[key(l),l]));
 return posts.filter(p=>p.state==='published').map(p=>({...p,label:annotations.get(key(p))||null,snapshot:latest.get(key(p))||null}));
}
export function totals(posts:MeasuredPost[]):Totals{
 return Object.fromEntries(metricNames.map(name=>{
  const values=posts.map(p=>p.snapshot?.metrics[name]).filter(finite);
  return [name,{value:values.length?values.reduce((a,b)=>a+b,0):null,covered:values.length,posts:posts.length}];
 })) as Totals;
}
export function previousRange(from:string,to:string){
 const length=Date.parse(to)-Date.parse(from)+86400000;
 return {from:new Date(Date.parse(from)-length).toISOString().slice(0,10),to:new Date(Date.parse(from)-86400000).toISOString().slice(0,10)};
}
export function cohort(posts:MeasuredPost[],from:string,to:string,filters:{channel?:string;category?:string;campaign?:string}={}){
 return posts.filter(p=>{
  if(!p.published_at||!Number.isFinite(Date.parse(p.published_at)))return false;
  const day=chicagoWall(Date.parse(p.published_at)).slice(0,10);
  return day>=from&&day<=to&&(!filters.channel||filters.channel==='all'||p.platform===filters.channel)&&(!filters.category||filters.category==='all'||p.label?.category===filters.category||filters.category==='Unclassified'&&!p.label)&&(!filters.campaign||p.label?.campaign_id&&campaignKey(p.label.campaign_kind!,p.label.campaign_id)===filters.campaign);
 });
}
export function compare(current:Total,previous:Total){
 // Missing coverage is not a decline. Percent changes require complete, comparable cohorts.
 if(current.value===null||previous.value===null||current.covered!==current.posts||previous.covered!==previous.posts)return null;
 return {absolute:current.value-previous.value,percent:previous.value>0?(current.value-previous.value)/previous.value*100:null};
}
export function groupPerformance(posts:MeasuredPost[],dimension:'channel'|'category'|'campaign'){
 const groups=new Map<string,MeasuredPost[]>();
 for(const post of posts){const value=dimension==='channel'?post.platform:dimension==='category'?post.label?.category||'Unclassified':post.label?.campaign_id?campaignKey(post.label.campaign_kind!,post.label.campaign_id):'Unattributed';groups.set(value,[...(groups.get(value)||[]),post]);}
 return [...groups].map(([name,rows])=>({name,posts:rows.length,metrics:totals(rows)}));
}
export function recommendations(posts:MeasuredPost[]):Recommendation[]{
 const result:Recommendation[]=[];
 for(const platform of ['facebook','instagram']){
  // One metric at a time, within one platform. No likes+reactions double counting or synthetic engagement rate.
  const available=posts.filter(p=>p.platform===platform&&finite(p.snapshot?.metrics.shares));
  if(available.length<6)continue;
  for(const dimension of ['format','category','schedule','template'] as const){
   const groups=new Map<string,MeasuredPost[]>();
   for(const p of available){const value=dimension==='format'?p.media_type:dimension==='category'?p.label?.category:dimension==='template'?p.label?.template:p.published_at?chicagoWall(Date.parse(p.published_at)).slice(11,13)+':00 CT':null;if(!value||value==='Unclassified')continue;groups.set(value,[...(groups.get(value)||[]),p]);}
   for(const [value,rows] of groups){const rest=available.filter(p=>!rows.includes(p));if(rows.length<3||rest.length<3)continue;
    const mean=(items:MeasuredPost[])=>items.reduce((n,p)=>n+(p.snapshot!.metrics.shares||0),0)/items.length;
    const average=mean(rows),baseline=mean(rest);
    if(average>baseline&&average>0)result.push({dimension,value,platform,metric:'shares',average,baseline,sample:rows.length,baselineSample:rest.length,post:rows.find(p=>p.url)||rows[0]});
   }
  }
 }
 return result.sort((a,b)=>(b.average-b.baseline)-(a.average-a.baseline)).slice(0,5);
}
export function spendResults(rows:SpendRow[],from:string,to:string,channel='all',campaign=''){
 const matched=rows.filter(r=>r.data.date>=from&&r.data.date<=to&&(channel==='all'?['facebook','instagram'].includes(r.data.source):r.data.source===channel)&&(!campaign||r.data.campaign===campaign));
 const sum=(key:'spend'|'clicks'|'impressions'|'leads')=>{const values=matched.map(r=>r.data[key]).filter(v=>v!==undefined&&v!==null&&v!=='').map(Number).filter(finite);return {value:values.length?values.reduce((a,b)=>a+b,0):null,rows:values.length};};
 const spend=sum('spend'),clicks=sum('clicks');
 return {rows:matched.length,spend,clicks,impressions:sum('impressions'),leads:sum('leads'),costPerClick:spend.rows===matched.length&&clicks.rows===matched.length&&clicks.value&&spend.value!==null?spend.value/clicks.value:null,confirmedSalesROI:null,attribution:'Staff-entered daily reporting. Campaign matches use the exact saved campaign identifier.'};
}
export function performance(posts:MeasuredPost[],from:string,to:string,filters:{channel?:string;category?:string;campaign?:string}={}){
 const prior=previousRange(from,to),current=cohort(posts,from,to,filters),previous=cohort(posts,prior.from,prior.to,filters),a=totals(current),b=totals(previous);
 return {from,to,prior,current:a,previous:b,posts:current,comparison:Object.fromEntries(metricNames.map(k=>[k,compare(a[k],b[k])])),channels:groupPerformance(current,'channel'),categories:groupPerformance(current,'category'),campaigns:groupPerformance(current,'campaign'),recommendations:recommendations(current),basis:'Latest available lifetime metrics for posts published in each Chicago date range, not activity earned within that range. Post reach is non-additive; audience overlaps are unknown. Unequal post ages can bias comparisons.'};
}
export function normalizeLegacyMetrics(raw:Record<string,unknown>):Metrics{
 const names:Record<string,MetricName>={views:'views',post_media_view:'views',likes:'likes',comments:'comments',saved:'saves',shares:'shares',reach:'reach',post_reactions_by_type_total:'reactions',post_impressions:'impressions',post_impressions_unique:'reach',post_impressions_paid:'paidImpressions',post_impressions_organic:'organicImpressions',post_impressions_paid_unique:'paidReach',post_impressions_organic_unique:'organicReach'};
 const result:Metrics={};
 for(const [remote,name] of Object.entries(names)){
  const data=raw[remote] as {period?:string;total_value?:unknown;values?:{value?:unknown}[]}|undefined;if(!data)continue;
  if(data.period&&data.period!=='lifetime'){result[name]=null;continue;}
  const value=data.total_value??data.values?.at(-1)?.value;
  result[name]=finite(value)?value:remote==='post_reactions_by_type_total'&&value&&typeof value==='object'&&Object.values(value).length>0&&Object.values(value).every(finite)?Object.values(value).reduce<number>((a,b)=>a+Number(b),0):null;
 }
 return result;
}
