export type HqTab = {id:string; label:string};
export const projectAreaTabs = [{id:'projects',label:'Projects'},{id:'deliverables',label:'Deliverables'},{id:'handoffs',label:'Handoffs'},{id:'store-open-checklist',label:'Store Open Checklist'},{id:'tracking',label:'Tracked links'},{id:'performance',label:'Results'}] as const;
export const projectAreaAliases = {launch:'store-open-checklist'};
export const projectTabs = [{id:'overview',label:'Overview'},{id:'deliverables',label:'Deliverables'},{id:'assets',label:'Assets'},{id:'budget',label:'Budget'},{id:'notes',label:'Notes / Activity'}] as const;
export const auctionTabs = [{id:'current-auction',label:'Current Auction'},{id:'deliverables',label:'Deliverables'},{id:'assets',label:'Assets'},{id:'budget',label:'Budget & Reconciliation'},{id:'auction-history',label:'Auction History'},{id:'overview',label:'Project information'},{id:'notes',label:'Notes / Activity'}] as const;
export const operationTabs = [{id:'staff',label:'Staff access'},{id:'permissions',label:'Permissions'}] as const;
export const requestDetailTabs = [{id:'request',label:'Request & decision'},{id:'notes',label:'Notes / Activity'}] as const;
export const assetTabs = [{id:'all-assets',label:'All Assets'},{id:'jons-content',label:"Jon’s Content"}] as const;
export const calendarTabs = [{id:'schedule',label:'Calendar'},{id:'releases',label:'Release Calendar'},{id:'planning',label:'Date planning'},{id:'entries',label:'Entries & series'}] as const;
export const requestTabs = [{id:'general',label:'General requests'},{id:'editorial',label:'Editorial queue'},{id:'top-stories',label:'Top stories'},{id:'stories',label:'Stories'},{id:'products',label:'Products'}] as const;
export function selectedTab(tabs:readonly HqTab[],requested:string|null,defaultTab:string,aliases:Record<string,string>={}){const value=requested&&Object.hasOwn(aliases,requested)?aliases[requested]:requested;return tabs.some(t=>t.id===value)?value!:defaultTab;}
export function tabHref(pathname:string,query:string,tab:string){
 const params=new URLSearchParams(query);params.set('tab',tab);
 // Transient actions and legacy navigation must not reopen when changing areas.
 params.delete('view');params.delete('create');params.delete('scope');
 if(tab!=='deliverables')params.delete('deliverable');
 if(!['deliverables','budget','auction-history'].includes(tab))params.delete('auction');
 return pathname+'?'+params.toString();
}
