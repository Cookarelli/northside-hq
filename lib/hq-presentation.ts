import {approvalCurrent, deliverableMissing, projectMissing, type Deliverable, type Project} from './hq-model.ts';
import {finished} from './hq-operations.ts';

export const statusLabels = {
  on_track: 'On Track', attention: 'Needs Attention', blocked: 'Blocked',
  in_review: 'In Review', not_started: 'Not Started', complete: 'Complete',
} as const;
export type VisualStatus = keyof typeof statusLabels;

// Presentation only: never persist these labels as workflow states.
export function workStatus(d: Deliverable, project?: Project): VisualStatus {
  if (finished(d)) return 'complete';
  if (d.blocked) return 'blocked';
  if (d.status === 'needs_review') return 'in_review';
  if (d.status === 'ready' && !approvalCurrent(d, project)) return 'attention';
  if (d.status === 'to_do') return 'not_started';
  return deliverableMissing(d, project).length ? 'attention' : 'on_track';
}

export function campaignStatus(project: Project): VisualStatus {
  if (project.status === 'completed') return 'complete';
  if (project.status === 'draft' || project.status === 'archived') return 'not_started';
  return projectMissing(project).length ? 'attention' : 'on_track';
}
