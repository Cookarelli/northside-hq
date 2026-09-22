'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {MaterialsEditor,ResourceLinks,type Asset} from '@/components/hq-materials';
import {Choice,Field,Person,dateLabel,json,loadWorkspace,type Action,type Workspace} from '@/components/hq-workspace';
import {blankRequest,destinations,effortLevels,projectTypes,recordedTime,type Deliverable,type HqContext,type HqRecord,type HqRequest,type Project,type RequestInput,type WorkspaceRecord} from '@/lib/hq-model';
import {RequestNotes} from '@/components/request-notes';
import {clientId} from '@/lib/client-id';
const requestStatuses={new:'New',accepted:'Accepted',declined:'Declined'};
export function HqRequests({id}:{id?:string}) {
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[creating,setCreating]=useState(false),[filter,setFilter]=useState('all'),[message,setMessage]=useState('');
 const lock=useRef(false),errorRef=useRef<HTMLDivElement>(null),router=useRouter();
 useEffect(()=>{const controller=new AbortController();loadWorkspace(controller.signal).then(setWorkspace).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[retry]);
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 const act:Action=async command=>{if(lock.current)return null;lock.current=true;setBusy(true);setError('');setMessage('');try{const result=await json<{id?:string}>('/api/hq',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});setWorkspace(await loadWorkspace());window.dispatchEvent(new Event('hq-records-changed'));setMessage('Saved.');return result;}catch(e){setError((e as Error).message);return null;}finally{lock.current=false;setBusy(false);}};
 const errorPanel=error&&<div ref={errorRef} tabIndex={-1} role="alert" className="notice error"><p>{error}</p><Button variant="outline" onClick={()=>{setError('');setRetry(n=>n+1);}}>Reload saved requests</Button></div>;
 if(!workspace)return <section className="panel">{errorPanel||<p role="status">Loading requests…</p>}</section>;
 const c=workspace.context,assets=workspace.records.filter(r=>r.kind==='asset') as Asset[],requests=workspace.records.filter(r=>r.kind==='request') as HqRecord<HqRequest>[],record=requests.find(r=>r.id===id);
 const name=(id:string)=>c.staff.find(s=>s.id===id)?.name||id;
 const save=async(command:Record<string,unknown>)=>{const result=await act(command);if(result?.id){setCreating(false);router.push('/requests/'+result.id);}};
 return <div className="hq-record-workspace">{errorPanel}{message&&<p role="status">{message}</p>}{id?<><Link href="/requests">← All requests</Link>{record?<>
 <section className="panel"><span className="tag">{requestStatuses[record.data.status]}</span><h2>{record.data.title}</h2><p>Requested by {name(record.data.requester)} · {recordedTime(record.data.createdAt)}</p><p className="hq-preserve-text">{record.data.purpose}</p><p>Requested deadline: {dateLabel(record.data.requestedDeadline)}</p><p className="muted">This is the requester’s preference. Production commitments are recorded on the linked deliverable.</p><ResourceLinks {...record.data} available={assets}/>
 {record.data.decision&&<p>{requestStatuses[record.data.status]} by {name(record.data.decision.by)} · {recordedTime(record.data.decision.at)}{record.data.decision.reason?' · '+record.data.decision.reason:''}</p>}
 {record.data.conversion&&<Link href={(record.data.conversion.kind==='project'?'/projects/':'/projects/work/')+record.data.conversion.id}>Open accepted work →</Link>}</section>
 <RequestNotes key={id} id={id} context={c} act={act} busy={busy}/>
 {record.data.status==='new'&&<>{(record.data.requester===c.staffId||c.canCoordinate)&&<details className="panel hq-details"><summary>Edit request</summary><RequestForm key={record.data.version} record={record} assets={assets} busy={busy} onSave={save}/></details>}{c.canCoordinate?<DecisionForm key={record.data.version} record={record} records={workspace.records} context={c} busy={busy} act={act}/>:<p className="notice">A request coordinator will accept this into production or record a decision reason.</p>}</>}
</>:<p className="panel">This request was not found in your workspace.</p>}</>:<>
 <div className="button-row"><Button onClick={()=>setCreating(true)}>New request</Button></div>
 {creating&&<section className="panel"><RequestForm assets={assets} busy={busy} onSave={save} onCancel={()=>setCreating(false)}/></section>}
 <Choice label="Request status" value={filter} onChange={setFilter} options={{all:'All requests',...requestStatuses}}/>
 <ul className="hq-deliverables">{requests.filter(r=>filter==='all'||r.data.status===filter).map(r=><li key={r.id}><div><Link href={'/requests/'+r.id}>{r.data.title}</Link><p className="muted">{name(r.data.requester)} · Requested: {dateLabel(r.data.requestedDeadline)}</p></div><span className="tag">{requestStatuses[r.data.status]}</span></li>)}</ul>{!requests.filter(r=>filter==='all'||r.data.status===filter).length&&<p className="notice">{requests.length?'No requests match this status. Choose All requests to see the others.':'No general requests yet. Start with what you need and what it is for.'}</p>}
 </>}</div>;
}
function RequestForm({record,assets,busy,onSave,onCancel}:{record?:HqRecord<HqRequest>;assets:Asset[];busy:boolean;onSave:(command:Record<string,unknown>)=>Promise<void>;onCancel?:()=>void}) {
 const [id]=useState(()=>record?.id||clientId()),[pending,setPending]=useState(false),[data,setData]=useState<RequestInput>(()=>record?{...blankRequest,...Object.fromEntries(Object.keys(blankRequest).map(k=>[k,record.data[k as keyof RequestInput]??blankRequest[k as keyof RequestInput]]))}:blankRequest);
 const update=(patch:Partial<RequestInput>)=>setData(d=>({...d,...patch}));
 return <form className="hq-form" onSubmit={e=>{e.preventDefault();if(!pending)void onSave({action:'save-request',id,version:record?.data.version||0,data});}}><fieldset disabled={busy} className="campaign-fields">
 <Field label="What is needed?"><Input required maxLength={300} value={data.title} onChange={e=>update({title:e.target.value})}/></Field>
 <Field label="What is it for?"><Textarea required maxLength={6000} rows={3} value={data.purpose} onChange={e=>update({purpose:e.target.value})}/></Field>
 <Field label="Requested deadline (optional · America/Chicago)"><Input type="datetime-local" value={data.requestedDeadline} onChange={e=>update({requestedDeadline:e.target.value})}/></Field>
 <MaterialsEditor value={data} onChange={update} available={assets} onPendingChange={setPending} referenceOnly/>
 <div className="button-row"><Button type="submit" disabled={pending}>{busy?'Saving…':record?'Save request':'Send request'}</Button>{onCancel&&<Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>}</div>
 </fieldset></form>;
}
function DecisionForm({record,records,context:c,busy,act}:{record:HqRecord<HqRequest>;records:WorkspaceRecord[];context:HqContext;busy:boolean;act:Action}) {
 const [decision,setDecision]=useState('accepted'),[reason,setReason]=useState(''),[targetKind,setTargetKind]=useState('project'),[targetId,setTargetId]=useState(''),[owner,setOwner]=useState(''),[approver,setApprover]=useState(''),[projectType,setProjectType]=useState('general'),[publishing,setPublishing]=useState(false),[platforms,setPlatforms]=useState<string[]>([]),[effort,setEffort]=useState('standard');
 const attempt=useRef<{body:string;id:string}|null>(null);
 const eligible=records.filter(r=>r.kind===targetKind&&(targetKind==='project'?!['completed','archived'].includes((r.data as Project).status):!(r.data as Deliverable).projectId&&(r.data as Deliverable).status!=='done'));
 return <section className="panel"><h2>Coordinator decision</h2><form className="hq-form" onSubmit={async e=>{e.preventDefault();const fields={action:'decide-request',id:record.id,version:record.data.version,decision,reason,targetKind,targetId,owner,approver,projectType,publishing,platforms,effort};const body=JSON.stringify(fields);if(attempt.current?.body!==body)attempt.current={body,id:clientId()};await act({...fields,decisionId:attempt.current.id});}}><fieldset disabled={busy} className="campaign-fields">
 <Choice label="Decision" value={decision} onChange={setDecision} options={{accepted:'Accept into production',declined:'Decline with a reason'}}/>
 {decision==='accepted'&&<><Choice label="Accept into" value={targetKind} onChange={v=>{setTargetKind(v);setTargetId('');}} options={{project:'Project',deliverable:'Standalone deliverable'}}/><Choice label="New or existing work" value={targetId} onChange={setTargetId} options={{'':'Create new '+(targetKind==='project'?'project':'standalone deliverable'),...Object.fromEntries(eligible.map(r=>[r.id,(r.data as Project).title]))}}/>
 {!targetId&&<><Person label="Owner of new work" value={owner} onChange={setOwner} staff={c.staff}/>{targetKind==='project'?<Choice label="Project type" value={projectType} onChange={setProjectType} options={projectTypes}/>:<><Person label="Designated standalone approver" value={approver} onChange={setApprover} staff={c.staff}/><Choice label="Effort" value={effort} onChange={setEffort} options={effortLevels}/><label className="check-field"><input type="checkbox" checked={publishing} onChange={e=>{setPublishing(e.target.checked);setPlatforms(e.target.checked?['facebook','instagram']:[]);}}/><span>This work will be published</span></label>{publishing&&<fieldset className="hq-checks"><legend>Destination platforms</legend>{destinations.map(p=><label key={p}><input type="checkbox" checked={platforms.includes(p)} onChange={e=>setPlatforms(e.target.checked?[...platforms,p]:platforms.filter(x=>x!==p))}/>{p}</label>)}</fieldset>}</>}</>}
 <p className="muted">The original request and requested deadline remain linked. Set the committed production deadline in the deliverable.</p></>}
 <Field label={decision==='declined'?'Decision reason (required)':'Decision reason (optional)'}><Textarea required={decision==='declined'} maxLength={5000} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
 <Button type="submit" disabled={busy||(decision==='accepted'&&!targetId&&(!owner||(targetKind==='deliverable'&&!approver)))}>{decision==='accepted'?'Accept request':'Decline request'}</Button>
 </fieldset></form></section>;
}
