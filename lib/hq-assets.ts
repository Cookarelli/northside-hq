import type {WorkspaceRecord} from './hq-model.ts';
export function jonAssetIds(records:WorkspaceRecord[]){
 const ids=new Set<string>();
 for(const record of records){
  const d=record.data as Record<string,unknown>;
  if(record.kind==='asset'&&(d.uploadedBy==='jon'||d.owner==='jon'))ids.add(record.id);
  if(!['project','deliverable','auction_campaign','post'].includes(record.kind))continue;
  const people=[d.owner,d.publisher,...(Array.isArray(d.members)?d.members:[]),...(Array.isArray(d.contributors)?d.contributors:[]),...(Array.isArray(d.assignees)?d.assignees:[])];
  if(people.includes('jon')&&Array.isArray(d.assets))for(const id of d.assets)if(typeof id==='string')ids.add(id);
 }
 return ids;
}
