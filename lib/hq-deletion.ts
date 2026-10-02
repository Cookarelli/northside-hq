import type {Deliverable,HqContext,HqRecord,Project,WorkspaceRecord} from './hq-model.ts';

export type DeletableRecord=HqRecord<Project|Deliverable>;
export function canDeleteRecord(data:Project|Deliverable,context:HqContext){
 return !data.deletedAt&&(context.admin||data.owner===context.staffId||(!data.owner&&data.createdBy===context.staffId));
}
export function attachedDeliverableCount(projectId:string,records:HqRecord<Deliverable>[]){
 return records.filter(r=>r.data.projectId===projectId&&!r.data.deletedAt).length;
}
// Retain tombstones for history, file assignments and legacy-adoption deduplication.
export function applyDeletedRecord(records:WorkspaceRecord[],deleted:WorkspaceRecord){
 return records.map(record=>record.kind===deleted.kind&&record.id===deleted.id?deleted:record);
}
