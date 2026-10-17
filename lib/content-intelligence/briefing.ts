import {chicagoWall,scheduleWall} from '../consignment.ts';
import {rankStory,type Detail,type Product} from '../content-radar/editorial-model.ts';
import type {Item} from '../content-radar/model.ts';
import type {Category,Idea,Template} from './model.ts';
import type {Recommendation} from './analytics.ts';

export type CalendarSlot={date:string;title?:string;recurrence?:string};
export function contentCategory(item:Pick<Item,'category'|'kind'|'title'|'summary'>):Category{
 const text=(item.category+' '+item.title+' '+item.summary).toLowerCase();
 if(/\bauction\b/.test(text))return 'Auctions';if(/\bconsign/.test(text))return 'Consignment';
 if(/pok[eé]mon/.test(text))return 'Pokemon';if(/entertainment|star wars|marvel|disney|garbage pail/.test(text))return 'Entertainment cards';
 if(/store promotion|in.store event|store opening/.test(text))return 'Store promotions';
 return item.kind==='release'?'New releases':item.kind==='chase'?'Chase cards':'Sports';
}
export function postingWindow(now:Date,calendar:CalendarSlot[],index=0){
 calendar=calendar.map(p=>({...p,date:scheduleWall(p.date)}));
 const wall=chicagoWall(now.getTime()),today=wall.slice(0,10);
 for(let day=0;day<8;day++){
  const date=new Date(Date.parse(today+'T12:00:00Z')+day*86400000).toISOString().slice(0,10);
  const tuesday=new Date(date+'T12:00:00Z').getUTCDay()===2;
  const occupied=calendar.filter(p=>p.date.slice(0,10)===date||p.recurrence==='weekly-tuesday'&&tuesday&&p.date.slice(0,10)<=date);
  if(occupied.length>=3)continue;
  for(const time of ['11:00','14:00','18:00']){
   const start=date+'T'+time;
   if(start<=wall||occupied.some(p=>Math.abs(Number(p.date.slice(11,13))*60+Number(p.date.slice(14,16))-(Number(time.slice(0,2))*60))<60))continue;
   if(index-->0)continue;
   return {start,end:date+'T'+String(Number(time.slice(0,2))+1).padStart(2,'0')+':00',timezone:'America/Chicago' as const,basis:'Calendar gap; an editorial suggestion, not a proven optimal time.'};
  }
 }
 return null;
}
export function dailyBriefing(items:Item[],details:Record<string,Detail>,products:Product[],calendar:CalendarSlot[],now=new Date(),preferred:Template='community-source'){
 const day=chicagoWall(now.getTime()).slice(0,10),notes:string[]=[];
 const seen=new Set<string>();
 const candidates=items.filter(i=>{
  if(i.status==='dismissed'||i.verification==='disputed'||!/^https:\/\//.test(i.url)||seen.has(i.url))return false;
  const age=i.published_at?((/^\d{4}-\d{2}-\d{2}$/.test(i.published_at)?Date.parse(day):now.getTime())-Date.parse(i.published_at))/86400000:null;
  const event=i.event_date?Math.abs(Date.parse(i.event_date)-Date.parse(day))/86400000:null;
  if(age!==null&&!Number.isFinite(age)||event!==null&&!Number.isFinite(event))return false;
  if(age!==null&&(age<0||age>14&&(event===null||event>3)))return false;
  if(age===null&&(event===null||event>3))return false;
  seen.add(i.url);return true;
 }).map(item=>({item,score:rankStory(item,details[item.id],products,now).score+(item.priority==='urgent'?30:item.priority==='high'?15:0)+(item.verification==='verified'?20:0)})).sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
 const ideas:Idea[]=[];
 for(const {item} of candidates){
  if(ideas.length>=5)break;
  const window=postingWindow(now,[...calendar,...ideas.map(i=>({date:i.window.start}))]);if(!window)break;
  const category=contentCategory(item),verified=item.verification==='verified',template=category==='Chase cards'?'collector-question':preferred;
  ideas.push({id:item.id,itemId:item.id,headline:item.title,category,sourceUrl:item.url,publishedAt:item.published_at,
   whyToday:item.event_date&&Math.abs(Date.parse(item.event_date)-Date.parse(day))<=3*86400000?`Source lists an event/release date of ${item.event_date}; check the publisher for changes.`:`Published ${item.published_at}; a recent ${category.toLowerCase()} topic for Northside collectors.`,
   window,confidence:verified&&item.published_at?'high':item.published_at?'medium':'low',verification:verified?'verified':'unverified',template,
   originalImagesRequired:true,inventoryRequired:['New releases','Store promotions'].includes(category),
   facebook:`On our collector radar: ${item.title}\n\nRead the source: ${item.url}\n\nWhat would you add to your collection? Talk cards with Northside.`,
   instagram:`${template==='collector-question'?'Collectors, what do you think about this story?':'On our collector radar:'} ${item.title}\n\nWhat would you add to your collection? Talk cards with Northside.`,
   checks:['Review the original source and every claim before approval.','Use an owned or licensed image; the source link is not image permission.',...(['New releases','Store promotions'].includes(category)?['Confirm exact store inventory or promotion terms before adding any availability claim.']:[]),...(!item.published_at?['Publication date is unknown.']:[])]});
 }
 if(ideas.length<3)notes.push(`Only ${ideas.length} eligible source-backed ideas; collect or verify more evidence. No filler stories were invented.`);
 notes.push('Source headlines are attributed draft material, not independently confirmed availability, scores, values, or completed sales.');
 return {ideas,notes};
}
export function recommendationIdeas(recs:Recommendation[],calendar:CalendarSlot[],now=new Date()):Idea[]{
 const ideas:Idea[]=[];
 for(const r of recs){if(!r.post.url)continue;const window=postingWindow(now,[...calendar,...ideas.map(i=>({date:i.window.start}))]);if(!window)break;
  const evidence=`${r.platform}: ${r.value} averaged ${r.average.toFixed(1)} shares across ${r.sample} posts versus ${r.baseline.toFixed(1)} across ${r.baselineSample} other posts. Lifetime observations; not causal evidence.`;
  ideas.push({id:`${r.platform}-${r.dimension}-${ideas.length}`,itemId:null,headline:`Test more ${r.value} content`,category:r.post.label?.category||'Sports',sourceUrl:r.post.url,publishedAt:r.post.published_at?.slice(0,10)||null,whyToday:evidence,window,confidence:'low',verification:'unverified',template:r.post.label?.template||'collector-question',originalImagesRequired:true,inventoryRequired:true,facebook:'Collectors, what would you like us to explore next? Talk cards with Northside.',instagram:'What would you add to your collection? Share your next collecting topic with Northside.',checks:['A small-sample editorial experiment, not a guaranteed lift.','Choose and verify a current topic and owned image before approval.',evidence]});
 }
 return ideas;
}
