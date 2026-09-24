'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {MaterialsEditor,type Asset} from '@/components/hq-materials';
import {scheduleWall} from '@/lib/consignment';
import {StaffPicker} from '@/components/staff-picker';
import {clientId} from '@/lib/client-id';
import {recordedTime,type Deliverable,type HqContext,type HqRecord,type Project} from '@/lib/hq-model';
import {canCompleteTask,canManageTask,taskAssignees,taskInput,taskPriorities,taskStatus,taskStatuses,type TaskInput,type TaskPriority} from '@/lib/project-tasks';
import type {Action} from '@/components/hq-workspace';

export function ProjectTaskForm({project,record,context,busy,onSave,onCancel,assets=[]}:{assets?:Asset[];project?:HqRecord<Project>;record?:HqRecord<Deliverable>;context:HqContext;busy:boolean;onSave:Action;onCancel:()=>void}) {
 const titleRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{const previous=document.activeElement;titleRef.current?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 const [id]=useState(()=>record?.id||clientId()),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const [data,setData]=useState<TaskInput>(()=>({title:record?.data.title||'',instructions:record?.data.instructions||'',projectId:project?.id||'',assignees:record?taskAssignees(record.data):[context.staffId],productionDue:scheduleWall(record?.data.productionDue||''),endAt:record?.data.endAt||'',priority:record?.data.priority||'normal',notes:record?.data.notes||'',storeOpenChecklist:record?.data.storeOpenChecklist||project?.data.storeOpenChecklist,department:record?.data.department,assets:record?.data.assets||[],references:record?.data.references||[],assetRoles:record?.data.assetRoles||{},linkRoles:record?.data.linkRoles||{}}));
 const update=(patch:Partial<TaskInput>)=>setData(old=>({...old,...patch}));
 const manager=canManageTask(record?.data,project?.data,context);
 return <form className="panel hq-form" onSubmit={async e=>{e.preventDefault();if(pending)return;const parsed=taskInput.safeParse(data);if(!parsed.success){setError(parsed.error.issues[0].path[0]==='assignees'?'Select at least one staff member.':parsed.error.issues[0].message);return;}setError('');if(await onSave({action:'save-task',id,version:record?.data.version||0,data:parsed.data}))onCancel();}}><h3>{record?'Edit deliverable':'Add deliverable'}</h3>{!record&&<p className="hq-meta">Starts as Not Started. Change its status from the project after saving.</p>}<fieldset disabled={busy} className="campaign-fields">
 <label className="field"><span>Title</span><Input ref={titleRef} required maxLength={300} value={data.title} onChange={e=>update({title:e.target.value})}/></label>
 <label className="field"><span>Description (optional)</span><Textarea maxLength={12000} value={data.instructions} onChange={e=>update({instructions:e.target.value})}/></label>
 <div className="two-fields"><label className="field"><span>Due date (Central)</span><Input type="date" value={data.productionDue.slice(0,10)} onChange={e=>update({productionDue:e.target.value?e.target.value+'T'+(data.productionDue.slice(11)||'09:00'):'',...(!e.target.value?{endAt:''}:{})})}/></label><label className="field"><span>Due time (Central)</span><Input type="time" required={!!data.productionDue} disabled={!data.productionDue} value={data.productionDue.slice(11,16)} onChange={e=>update({productionDue:data.productionDue.slice(0,10)+'T'+e.target.value})}/></label></div>
 <label className="field"><span>End date and time (optional, Central)</span><Input type="datetime-local" disabled={!data.productionDue} min={data.productionDue} value={data.endAt} onChange={e=>update({endAt:e.target.value})}/></label>
 <StaffPicker label="Assigned staff" value={data.assignees} onChange={assignees=>update({assignees})} staff={context.staff} disabled={!manager}/>{!manager&&<p className="muted">You can add work assigned to yourself. The primary owner or an administrator assigns other staff.</p>}
 <label className="field"><span>Priority</span><select value={data.priority} onChange={e=>update({priority:e.target.value as TaskPriority})}>{Object.entries(taskPriorities).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 <label className="field"><span>Optional notes</span><Textarea maxLength={12000} value={data.notes} onChange={e=>update({notes:e.target.value})}/></label>
 <MaterialsEditor referenceOnly value={{assets:data.assets||[],references:data.references||[],assetRoles:data.assetRoles,linkRoles:data.linkRoles}} onChange={update} available={assets} onPendingChange={setPending}/>
 {error&&<p role="alert">{error}</p>}<div className="button-row"><Button type="submit" disabled={pending}>{busy?'Saving…':record?'Save deliverable':'Create deliverable'}</Button><Button type="button" variant="outline" disabled={pending} onClick={onCancel}>Cancel</Button></div>
 </fieldset></form>;
}

export function TaskActions({record,project,context,busy,act}:{record:HqRecord<Deliverable>;project?:Project;context:HqContext;busy:boolean;act:Action}) {
 const d=record.data;
 return <section className="panel"><h2>Status · {taskStatuses[taskStatus(d)]}</h2>
 {canCompleteTask(d,project,context)&&!['completed','archived'].includes(project?.status||'')&&<div className="button-row">{Object.entries(taskStatuses).map(([status,label])=><Button key={status} variant={taskStatus(d)===status?'default':'outline'} disabled={busy||taskStatus(d)===status} onClick={()=>void act({action:'task-status',id:record.id,version:d.version,status})}>{label}</Button>)}</div>}
 </section>;
}

export function DeliverableDetails({record,project,context,busy,act}:{record:HqRecord<Deliverable>;project?:Project;context:HqContext;busy:boolean;act:Action}) {
 const d=record.data,[priority,setPriority]=useState<TaskPriority>(d.priority||'normal'),[notes,setNotes]=useState(d.notes||''),[confirm,setConfirm]=useState(false);
 const manager=canManageTask(d,project,context),locked=Object.values(d.publications).some(p=>p.status!=='planned');
 if(d.deletedAt)return <section className="panel"><h2>Deleted deliverable</h2><p>This record and its history are preserved. It is hidden from the calendar and active assignments.</p>{manager&&<Button disabled={busy} onClick={()=>void act({action:'task-restore',id:record.id,version:d.version})}>Restore deliverable</Button>}<p><Link href={'/projects/'+d.projectId}>Back to project</Link></p></section>;
 return <section className="panel"><h2>Priority and notes</h2><p>{taskPriorities[d.priority||'normal']} priority</p>{d.notes&&<p className="hq-preserve-text">{d.notes}</p>}{d.completedAt&&<p>Completed {recordedTime(d.completedAt)}</p>}{manager?<details className="hq-details"><summary>Edit priority and notes</summary><form className="hq-form" onSubmit={e=>{e.preventDefault();void act({action:'task-metadata',id:record.id,version:d.version,data:{priority,notes}});}}><label className="field"><span>Priority</span><select disabled={busy} value={priority} onChange={e=>setPriority(e.target.value as TaskPriority)}>{Object.entries(taskPriorities).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label className="field"><span>Optional notes</span><Textarea disabled={busy} maxLength={12000} value={notes} onChange={e=>setNotes(e.target.value)}/></label><Button disabled={busy} type="submit">Save priority and notes</Button></form></details>:<><p>{taskPriorities[d.priority||'normal']}</p><p className="hq-preserve-text">{d.notes||'No notes'}</p></>}
 {manager&&!locked&&<details className="hq-details"><summary>Remove deliverable</summary><p>Delete removes this item from active lists and the calendar. Its record and history remain available to restore.</p><label className="check-field"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Delete this deliverable from active work</label><Button variant="outline" disabled={busy||!confirm} onClick={()=>void act({action:'task-delete',id:record.id,version:d.version})}>Delete deliverable</Button></details>}</section>;
}
