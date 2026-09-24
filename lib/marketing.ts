import {STORE_OPEN_PLAN_FIELDS} from './store-opening.ts';
export const PLATFORMS = ['facebook','instagram','x','snapchat','tiktok'];
export const DEFAULT_PLAN = {budget:5000,address:'',campaign:'northside_new_store_launch',aov:85,margin:25,...STORE_OPEN_PLAN_FIELDS};
export const ROADMAP = [
 ['Now','Launch control','Budget model, saved campaign settings, weekly content plan, UTM links, uploaded assets, timestamped transcript matching, manual clip review, editing exports and manual performance entry.'],
 ['Next · 1–2 development weeks','Automatic video processing','Connect a timestamped speech provider and a separate FFmpeg worker. Add resumable large uploads, job progress, preview renders, subtitles, thumbnails and approved export bundles. Estimate depends on access and sample footage.'],
 ['Then · 1–2 development weeks','Connected measurement','Shopify orders and refunds, GA4 traffic, Meta and Google spend. Add webhook deduplication, metric definitions, token refresh, sync status and reconciliation.'],
 ['Later · 1–2 development weeks','Learning and publishing','Rank candidate clips using approved/rejected labels, add nonverbal cues, and connect supported publishing APIs. Human approval stays before public publishing. Platform reviews can extend timing.']
];
export const EXPORT_PROFILES = [
 {id:'vertical',width:1080,height:1920,ratio:'9:16',platforms:['facebook','instagram','tiktok','snapchat','x']},
 {id:'feed',width:1080,height:1350,ratio:'4:5',platforms:['facebook','instagram']},
 {id:'square',width:1080,height:1080,ratio:'1:1',platforms:['facebook','instagram','x']},
 {id:'landscape',width:1920,height:1080,ratio:'16:9',platforms:['facebook','x']}
];
export function budgetRows(budget:number) {
 const test=budget===5000?250:0;
 return [{name:'Meta discovery',amount:Math.round(budget*.4)-test,color:'#00a7e9'},{name:'Meta warm audience',amount:Math.round(budget*.2),color:'#006990'},{name:'Google local search',amount:Math.round(budget*.3),color:'#141c2b'},...(test?[{name:'One optional channel test',amount:test,color:'#738ba4'}]:[]),{name:'Held reserve',amount:Math.round(budget*.1),color:'#d7e2ee'}];
}
export function forecast(budget:number,level='base') {
 const rates:Record<string,number[]>={cautious:[18,.008,3.5,.03,.007],base:[12,.012,2,.05,.012],strong:[9,.015,1.5,.07,.02]};
 const [cpm,ctr,cpc,leadRate,orderRate]=rates[level]||rates.base;
 const meta=budget*.6-(budget===5000?250:0),google=budget*.3;
 const impressions=Math.round(meta/cpm*1000),clicks=Math.round(impressions*ctr+google/cpc),sessions=Math.round(clicks*.85);
 return {impressions,clicks,sessions,leads:Math.round(sessions*leadRate),orders:Math.round(sessions*orderRate),spend:meta+google};
}
export function slug(s:string) {return s.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');}
export function trackingUrl(base:string,source:string,medium:string,campaign:string,content:string) {
 const u=new URL(base);if(u.protocol!=='https:'||u.username||u.password)throw new Error('Use a public HTTPS destination.');
 for(const [k,v] of Object.entries({utm_source:source,utm_medium:medium,utm_campaign:campaign,utm_content:content})) {const clean=slug(v);if(!clean)throw new Error('Complete every tracking field.');u.searchParams.set(k,clean);}
 return u.toString();
}
export type Segment={start:number;end:number;text:string};
export type Clip={id:string;start:number;end:number;signal:string;text:string;approved:boolean;caption:string;triggerTime?:number};
function stamp(s:string) {const p=s.replace(',','.').split(':').map(Number);return p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+p[1];}
export function parseTranscript(input:string):Segment[] {
 if(input.trim().startsWith('[')||input.trim().startsWith('{')) {const j=JSON.parse(input);const a=Array.isArray(j)?j:j.segments;
  if(!Array.isArray(a))throw new Error('JSON needs an array of start, end and text segments.');
  if(a.some(x=>!Number.isFinite(x.start)||!Number.isFinite(x.end)||x.start<0||x.end<=x.start||typeof x.text!=='string'))throw new Error('Invalid transcript timestamps.');return a.sort((x,y)=>x.start-y.start);
 }
 const a:Segment[]=[];const blocks=input.replace(/\r/g,'').split(/\n\s*\n/);
 for(const b of blocks) {const lines=b.split('\n');const i=lines.findIndex(l=>l.includes('-->'));if(i<0)continue;
  const m=lines[i].match(/(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)/);
  if(m){const start=stamp(m[1]),end=stamp(m[2]);if(Number.isFinite(start)&&end>start)a.push({start,end,text:lines.slice(i+1).join(' ').replace(/<[^>]*>/g,'')});}
 }
 if(!a.length)throw new Error('No timestamps found. Paste SRT, VTT or segment JSON.');return a.sort((x,y)=>x.start-y.start);
}
export function findClips(segments:Segment[],signals:string,before:number,after:number,duration:number):Clip[] {
 if(!Number.isFinite(duration)||duration<=0||before<0||after<=0)throw new Error('Use a positive source duration and valid clip window.');
 const keys=signals.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);if(!keys.length)throw new Error('Add at least one signal.');const hits:Clip[]=[];
 for(const s of segments){if(s.start>=duration)continue;const words=s.text.toLowerCase().replace(/[^a-z0-9]+/g,' ');const signal=keys.find(k=>(' '+words+' ').includes(' '+k.replace(/[^a-z0-9]+/g,' ')+' '));if(!signal)continue;
  const start=Math.max(0,s.start-before),end=Math.min(duration,s.start+after);if(end<=start)continue;const p=hits[hits.length-1];
  if(p&&start<p.end){p.end=Math.min(duration,Math.max(p.end,end));p.text+=' '+s.text;continue;}
  hits.push({id:'clip_'+s.start.toFixed(3).replace('.','_'),start,end,signal,text:s.text,approved:false,caption:'',triggerTime:s.start});
 }return hits;
}
