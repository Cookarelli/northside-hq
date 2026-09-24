import type {WorkspaceRecord,Deliverable} from './hq-model.ts';
import type {AssetData} from './asset-upload.ts';
export type SavedAsset={kind?:string;id:string;data:AssetData};
// Upload collection stays stable when staff change an assignment. Legacy Jon uploads remain visible.
export function jonAssetIds(records:WorkspaceRecord[]){return new Set(records.filter(r=>r.kind==='asset'&&((r.data as AssetData).collection==='jons-content'||(r.data as AssetData).uploadedBy==='jon'||(r.data as {owner?:string}).owner==='jon')).map(r=>r.id));}
export function assignedAsset(asset:Pick<SavedAsset,'data'>){return !!(asset.data.assignedProjectId||asset.data.assignedDeliverableId);}
export function assetTitle(asset:SavedAsset){return asset.data.title?.trim()||asset.data.name;}
export function newestAssets(assets:SavedAsset[]){return [...assets].sort((a,b)=>(Date.parse(b.data.uploadedAt||b.data.createdAt||'')||0)-(Date.parse(a.data.uploadedAt||a.data.createdAt||'')||0)||a.id.localeCompare(b.id));}
export function filterAssets(assets:SavedAsset[],search:string,filter:'all'|'assigned'|'unassigned'){
 const needle=search.trim().toLowerCase();return assets.filter(a=>(filter==='all'||assignedAsset(a)===(filter==='assigned'))&&[a.data.name,a.data.title||''].some(value=>value.toLowerCase().includes(needle)));
}
export function assignedAssetIds(assets:{id:string;data:{assignedProjectId?:string;assignedDeliverableId?:string}}[],kind:'project'|'deliverable',id:string){return assets.filter(a=>kind==='deliverable'?a.data.assignedDeliverableId===id:a.data.assignedProjectId===id&&!a.data.assignedDeliverableId).map(a=>a.id);}

export function assetProjectHref(id:string){return '/projects/'+encodeURIComponent(id)+'?tab=assets';}
export function assetDeliverableHref(id:string,deliverable:Pick<Deliverable,'projectId'>){return deliverable.projectId?'/projects/'+encodeURIComponent(deliverable.projectId)+'?tab=deliverables&deliverable='+encodeURIComponent(id)+'#deliverable-'+encodeURIComponent(id):'/projects/work/'+encodeURIComponent(id);}
