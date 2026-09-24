'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {StoreOpeningWarning} from '@/components/store-open-deadline';
import {StaffPicker} from '@/components/staff-picker';
import {MaterialsEditor,type Asset,type Materials} from '@/components/hq-materials';
import {blankProject,projectDraft,projectInput,projectStatuses,type Project,type HqRecord,type HqContext,type Deliverable} from '@/lib/hq-model';
import {taskAssignees,taskInput,taskPriorities,taskStatuses,type TaskPriority,type TaskStatus} from '@/lib/project-tasks';
import {STORE_OPENING_WALL} from '@/lib/store-opening';
import {scheduleWall} from '@/lib/consignment';
import {clientId} from '@/lib/client-id';
import type {Action} from '@/components/hq-workspace';

export type ChecklistEditor={kind:'project';record?:HqRecord<Project>}|{kind:'deliverable';record?:HqRecord<Deliverable>;projectId?:string};
export function StoreOpenForm({editor,projects,departments,context,assets,busy,act,onClose}:{editor:ChecklistEditor;projects:HqRecord<Project>[];departments:string[];context:HqContext;assets:Asset[];busy:boolean;act:Action;onClose:()=>void}) {
 const record=editor.record,d=record?.data;
 const [id]=useState(()=>record?.id||clientId()),[title,setTitle]=useState(d?.title||''),[owner,setOwner]=useState(d?.owner||context.staffId),[members,setMembers]=useState(editor.kind==='project'?editor.record?.data.members||[]:editor.record?taskAssignees(editor.record.data).slice(1):[]);
 const [department,setDepartment]=useState(d?.department||''),[due,setDue]=useState(scheduleWall(editor.kind==='project'?editor.record?.data.eventAt||STORE_OPENING_WALL:editor.record?.data.productionDue||STORE_OPENING_WALL));
 const [priority,setPriority]=useState<TaskPriority>(d?.priority||'normal'),[description,setDescription]=useState(editor.kind==='project'?editor.record?.data.brief||'':editor.record?.data.instructions||''),[notes,setNotes]=useState(editor.kind==='deliverable'?editor.record?.data.notes||'':'');
 const [endAt,setEndAt]=useState(editor.kind==='deliverable'?scheduleWall(editor.record?.data.endAt||''):''),[projectId,setProjectId]=useState(editor.kind==='deliverable'?editor.record?.data.projectId||editor.projectId||'':''),[status,setStatus]=useState(editor.kind==='project'?editor.record?.data.status||'active':'not_started');
 const [materials,setMaterials]=useState<Materials>({assets:d?.assets||[],references:d?.references||[],assetRoles:d?.assetRoles||{},linkRoles:d?.linkRoles||{}}),[pending,setPending]=useState(false),[error,setError]=useState('');
 const titleRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{const previous=document.activeElement;titleRef.current?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 async function submit(e:React.FormEvent){e.preventDefault();if(pending||busy)return;setError('');
  const common={title,department,priority,storeOpenChecklist:true,...materials};
  const parsed=editor.kind==='project'?projectInput.safeParse({...(editor.record?projectDraft(editor.record.data):blankProject),...common,owner,members:members.filter(id=>id!==owner),brief:description,eventAt:due,status}):taskInput.safeParse({...common,instructions:description,projectId,assignees:[owner,...members.filter(id=>id!==owner)],productionDue:due,endAt,notes,...(!record?{initialStatus:status as TaskStatus}:{})});
  if(!parsed.success){setError(parsed.error.issues[0]?.message||'Check the fields.');return;}
  if(await act({action:editor.kind==='project'?'save-project':'save-task',id,version:d?.version||0,data:parsed.data}))onClose();
 }
 return <form className="panel hq-form store-open-form" onSubmit={submit} aria-label={(record?'Edit ':'Add ')+(editor.kind==='project'?'Project':'Deliverable')}><h3>{record?'Edit':'Add'} {editor.kind==='project'?'Project':'Deliverable'}</h3><fieldset className="campaign-fields" disabled={busy}>
 <label className="field"><span>{editor.kind==='project'?'Project name':'Title'}</span><Input ref={titleRef} required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 {editor.kind==='deliverable'&&!record&&<label className="field"><span>Project</span><select value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">Directly in Store Open Checklist</option>{projects.filter(p=>!['completed','archived'].includes(p.data.status)).map(p=><option key={p.id} value={p.id}>{p.data.title}</option>)}</select></label>}
 <div className="two-fields"><label className="field"><span>Department / category (optional)</span><Input list="checklist-departments" maxLength={100} value={department} placeholder={projectId?'Use project department':'Or group by owner'} onChange={e=>setDepartment(e.target.value)}/><datalist id="checklist-departments">{departments.map(name=><option key={name} value={name}/>)}</datalist></label>
 <label className="field"><span>Owner</span><select required value={owner} onChange={e=>setOwner(e.target.value)}>{context.staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
 <StaffPicker label={editor.kind==='project'?'Additional members':'Additional assignees'} staff={context.staff.filter(s=>s.id!==owner)} value={members.filter(id=>id!==owner)} onChange={setMembers}/>
 <div className="two-fields"><label className="field"><span>Due date and time (America/Chicago)</span><Input required type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/></label><label className="field"><span>Priority</span><select value={priority} onChange={e=>setPriority(e.target.value as TaskPriority)}>{Object.entries(taskPriorities).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label></div>
 {editor.kind==='deliverable'&&editor.record?.data.endAt&&<label className="field"><span>End date and time (America/Chicago)</span><Input type="datetime-local" value={endAt} onChange={e=>setEndAt(e.target.value)}/></label>}
 <StoreOpeningWarning date={due}/>
 {(editor.kind==='project'||!record)&&<label className="field"><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value)}>{Object.entries(editor.kind==='project'?projectStatuses:taskStatuses).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>}
 <label className="field"><span>Description{editor.kind==='deliverable'?' (optional)':''}</span><Textarea required={editor.kind==='project'&&status!=='draft'} maxLength={12000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 {editor.kind==='deliverable'&&<label className="field"><span>Notes (optional)</span><Textarea maxLength={12000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>}
 <MaterialsEditor referenceOnly value={materials} onChange={setMaterials} available={assets} onPendingChange={setPending}/>
 {error&&<p role="alert">{error}</p>}<div className="button-row"><Button type="submit" disabled={pending}>{busy?'Saving…':record?'Save changes':editor.kind==='project'?'Create project':'Create deliverable'}</Button><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button></div>
 </fieldset></form>;
}
