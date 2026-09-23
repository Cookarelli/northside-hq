'use client';
import {useHqClock} from '@/components/use-hq-clock';
import {useState} from 'react';
import {finished} from '@/lib/hq-operations';
import {canManageTask,urgencySort} from '@/lib/project-tasks';
import type {Deliverable,HqRecord,HqContext,Project} from '@/lib/hq-model';
import {HqWorkItem} from '@/components/hq-work-item';
import {ProjectTaskForm} from '@/components/project-task';
import type {Action} from '@/components/hq-workspace';
export function HqProjectDeliverables({records,project,context,act,busy}:{records:HqRecord<Deliverable>[];project:HqRecord<Project>;context:HqContext;act:Action;busy:boolean}){
 const now=useHqClock();
 const [editing,setEditing]=useState(''),visible=records.filter(r=>!r.data.deletedAt),open=visible.filter(r=>!finished(r.data)).sort(urgencySort),complete=visible.filter(r=>finished(r.data));
 const row=(r:HqRecord<Deliverable>)=><HqWorkItem key={r.id} record={r} now={now} project={project} context={context} act={act} busy={busy} statusControl onEdit={r.data.workflow==='task'&&canManageTask(r.data,project.data,context)&&!['completed','archived'].includes(project.data.status)?()=>setEditing(r.id):undefined}/>;
 const record=visible.find(r=>r.id===editing);
 return <>{record&&<ProjectTaskForm key={record.id+':'+record.data.version} project={project} record={record} context={context} busy={busy} onSave={act} onCancel={()=>setEditing('')}/>}<h3>Open deliverables <span className="hq-count">{open.length}</span></h3>{open.length?<ul className="hq-work-list">{open.map(row)}</ul>:<p className="hq-meta">No open deliverables. Add one above to schedule the next step.</p>}{!!complete.length&&<details className="hq-details"><summary>Completed ({complete.length})</summary><ul className="hq-work-list">{complete.map(row)}</ul></details>}</>;
}
