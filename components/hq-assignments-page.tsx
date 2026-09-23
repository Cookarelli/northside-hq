'use client';
import {useEffect,useState} from 'react';
import {loadWorkspace,type Workspace} from '@/lib/hq-client';
import type {Deliverable,HqRecord,Project} from '@/lib/hq-model';
import {useHqClock} from '@/components/use-hq-clock';
import {MyAssignments} from '@/components/my-assignments';
import {Button} from '@/components/ui/button';
export function HqAssignmentsPage(){
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),now=useHqClock();
 useEffect(()=>{const reload=()=>setRetry(n=>n+1);window.addEventListener('hq-records-changed',reload);return()=>window.removeEventListener('hq-records-changed',reload);},[]);
 useEffect(()=>{const controller=new AbortController();loadWorkspace(controller.signal).then(data=>{setWorkspace(data);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[retry]);
 return <>{error&&<div className="panel" role="alert"><p>{error}</p><Button variant="outline" onClick={()=>setRetry(n=>n+1)}>Retry assignments</Button></div>}{workspace&&now!==null?<MyAssignments records={workspace.records.filter(r=>r.kind==='deliverable') as HqRecord<Deliverable>[]} projects={workspace.records.filter(r=>r.kind==='project') as HqRecord<Project>[]} context={workspace.context} now={now}/>:!error&&<p role="status">Loading assignments…</p>}</>;
}
