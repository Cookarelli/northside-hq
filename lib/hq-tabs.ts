export type HqTab = {id:string; label:string; secondary?:boolean};
export const projectAreaTabs = [{id:'projects',label:'Projects'},{id:'deliverables',label:'Deliverables'},{id:'handoffs',label:'Handoffs',secondary:true},{id:'store-open-checklist',label:'Store Open Checklist'},{id:'tracking',label:'Tracked links',secondary:true},{id:'performance',label:'Results',secondary:true}] as const;
export const projectAreaAliases = {launch:'store-open-checklist'};
export const projectTabs = [{id:'overview',label:'Overview'},{id:'deliverables',label:'Deliverables'},{id:'assets',label:'Assets'},{id:'budget',label:'Budget'},{id:'notes',label:'Notes / Activity',secondary:true}] as const;
export const auctionTabs = [{id:'current-auction',label:'Current Auction'},{id:'deliverables',label:'Deliverables'},{id:'assets',label:'Assets',secondary:true},{id:'budget',label:'Budget & Reconciliation'},{id:'auction-history',label:'Auction History',secondary:true},{id:'overview',label:'Project information',secondary:true},{id:'notes',label:'Notes / Activity',secondary:true}] as const;
export const settingsTabs = [{id:'staff',label:'Staff access'},{id:'permissions',label:'Permissions'}] as const;
export const assignmentTabs = [{id:'active',label:'Active'},{id:'completed',label:'Completed'},{id:'projects',label:'My projects'}] as const;
export const calendarTabAliases = {releases:'schedule'};
export const requestDetailTabs = [{id:'request',label:'Request & decision'},{id:'notes',label:'Notes / Activity',secondary:true}] as const;
export const assetTabs = [{id:'all-assets',label:'All Assets'},{id:'jons-content',label:"Jon’s Content"}] as const;
export const calendarTabs = [{id:'schedule',label:'Calendar'},{id:'planning',label:'Date planning'},{id:'entries',label:'Entries & series'}] as const;
export const requestTabs = [{id:'general',label:'General requests'},{id:'editorial',label:'Editorial queue'},{id:'top-stories',label:'Top stories',secondary:true},{id:'stories',label:'Stories',secondary:true},{id:'products',label:'Products',secondary:true}] as const;
export function selectedTab(tabs:readonly HqTab[],requested:string|null,defaultTab:string,aliases:Record<string,string>={}){const value=requested&&Object.hasOwn(aliases,requested)?aliases[requested]:requested;return tabs.some(t=>t.id===value)?value!:defaultTab;}
export function tabHref(pathname:string,query:string,tab:string,queryKey='tab'){
 const params=new URLSearchParams(query);params.set(queryKey,tab);
 if(queryKey!=='tab')return pathname+'?'+params.toString();
 // Transient actions and legacy navigation must not reopen when changing areas.
 params.delete('view');params.delete('create');params.delete('scope');
 if(tab!=='deliverables')params.delete('deliverable');
 if(!['deliverables','budget','auction-history'].includes(tab))params.delete('auction');
 return pathname+'?'+params.toString();
}
