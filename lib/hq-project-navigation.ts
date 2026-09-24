import {auctionTabs,projectTabs,type HqTab} from './hq-tabs.ts';
import {instant} from './hq-operations.ts';
import type {AuctionCampaignData} from './auction-campaigns.ts';
import type {Deliverable,HqRecord,Project} from './hq-model.ts';

export function projectSections(project:HqRecord<Project>,records:HqRecord<Deliverable>[],assets:{data:{assignedProjectId?:string}}[],weekly:boolean,canCreate:boolean,hasHistory:boolean,campaigns:HqRecord<AuctionCampaignData>[]=[]):readonly HqTab[]{
 const work=records.filter(r=>r.data.projectId===project.id&&!r.data.deletedAt);
 const hasAssets=project.data.assets.length>0||project.data.references.length>0||work.some(r=>r.data.assets.length||r.data.references.length)||assets.some(a=>a.data.assignedProjectId===project.id)||campaigns.some(c=>c.data.projectId===project.id&&c.data.assetLinks?.length);
 return (weekly?auctionTabs:projectTabs).filter(tab=>tab.id==='assets'?hasAssets:tab.id==='deliverables'?canCreate||work.length>0||records.some(r=>r.data.projectId===project.id&&r.data.deletedAt):tab.id==='auction-history'?hasHistory:true);
}

// The next closing auction is the daily landing view. Unfinished past auctions
// remain current when no upcoming auction exists; other closed auctions are history.
export function auctionNavigation(campaigns:HqRecord<AuctionCampaignData>[],now:number){
 const ordered=[...campaigns].sort((a,b)=>(instant(a.data.closesAt)??Infinity)-(instant(b.data.closesAt)??Infinity)||a.data.auction_number-b.data.auction_number);
 const open=ordered.filter(c=>!c.data.reconciliation?.at);
 const current=open.find(c=>(instant(c.data.closesAt)??Infinity)>=now)||open.at(-1);
 const history=ordered.filter(c=>c.id!==current?.id&&(!!c.data.reconciliation?.at||(instant(c.data.closesAt)??Infinity)<now)).reverse();
 return {current,history,upcoming:ordered.filter(c=>c.id!==current?.id&&!history.includes(c))};
}
export function projectTabHref(projectId:string,tab:string,focus?:{auction?:string;deliverable?:string}){
 const params=new URLSearchParams({tab});if(focus?.auction)params.set('auction',focus.auction);if(focus?.deliverable)params.set('deliverable',focus.deliverable);
 return '/projects/'+encodeURIComponent(projectId)+'?'+params.toString()+(focus?.deliverable?'#deliverable-'+encodeURIComponent(focus.deliverable):'');
}
export function recordActionHref(kind:string,id:string,action:string){
 const tab=/budget|spend|reconcile/.test(action)?'budget':/comment|mention/.test(action)?'notes':kind==='deliverable'&&/publish|publication/.test(action)?'publishing':kind==='project'?'overview':'work';
 return (kind==='project'?'/projects/':kind==='deliverable'?'/projects/work/':'/requests/')+encodeURIComponent(id)+'?tab='+(kind==='request'&&tab==='work'?'request':tab)+(kind==='project'&&tab==='budget'?'&scope=project':'');
}
