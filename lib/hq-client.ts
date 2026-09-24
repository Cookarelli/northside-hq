import type {HqContext,WorkspaceRecord} from './hq-model';
export type Workspace={records:WorkspaceRecord[];context:HqContext};
export function notifyWorkspaceChanged(){window.dispatchEvent(new Event('hq-records-changed'));if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('northside-hq-records');channel.postMessage('changed');channel.close();}}
export async function json<T>(url:string,options?:RequestInit):Promise<T> {const r=await fetch(url,{cache:'no-store',...options});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not load the workspace.');return data;}
export async function loadWorkspace(signal?:AbortSignal):Promise<Workspace> {
  const recordsPromise=(async()=>{const all:WorkspaceRecord[]=[];let cursor:number|null=0;do {const page:{records:WorkspaceRecord[];nextCursor:number|null}=await json('/api/records?cursor='+cursor,{signal});all.push(...page.records);cursor=page.nextCursor;}while(cursor!==null);return all;})();
  const [records,context]=await Promise.all([recordsPromise,json<HqContext>('/api/hq',{signal})]);return {records,context};
}
