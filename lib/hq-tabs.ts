export type HqTab = {id:string; label:string};
export const projectTabs = [{id:'overview',label:'Overview'},{id:'deliverables',label:'Deliverables'},{id:'assets',label:'Assets'},{id:'budget',label:'Budget'},{id:'notes',label:'Notes'}] as const;
export const assetTabs = [{id:'all-assets',label:'All Assets'},{id:'jons-content',label:"Jon’s Content"}] as const;
export const calendarTabs = [{id:'schedule',label:'Schedule'},{id:'planning',label:'Date planning'},{id:'entries',label:'Entries & series'},{id:'releases',label:'Releases'}] as const;
export const requestTabs = [{id:'general',label:'General requests'},{id:'editorial',label:'Editorial queue'},{id:'top-stories',label:'Top stories'},{id:'stories',label:'Stories'},{id:'products',label:'Products'},{id:'staff',label:'Staff access'}] as const;
export function selectedTab(tabs:readonly HqTab[],requested:string|null,defaultTab:string){return tabs.some(t=>t.id===requested)?requested!:defaultTab;}
export function tabHref(pathname:string,query:string,tab:string){
 const params=new URLSearchParams(query);params.set('tab',tab);
 // Transient actions and legacy navigation must not reopen when changing areas.
 params.delete('view');params.delete('create');
 if(tab!=='deliverables')params.delete('deliverable');
 return pathname+'?'+params.toString();
}
