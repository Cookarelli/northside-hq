'use client';
import {HqSubnavigation,useHqTab} from '@/components/hq-subnavigation';
const assignmentTabs=[{id:'active',label:'Active work'},{id:'completed',label:'Completed'},{id:'projects',label:'My projects'}];
import {useRef,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import type {Deliverable,HqContext,HqRecord,Project} from '@/lib/hq-model';
import {assignmentGroups} from '@/lib/hq-presentation';
import {primaryOwnerLabel} from '@/lib/project-tasks';
import {json} from '@/lib/hq-client';
import {HqWorkItem} from '@/components/hq-work-item';
import type {Action} from '@/components/hq-workspace';
export function MyAssignments({records,projects,context,now,compact=false}:{records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];context:HqContext;now:number;compact?:boolean}) {
 const tab=useHqTab(assignmentTabs,'active');
 const [updates,setUpdates]=useState<Record<string,Deliverable>>({});
 const current=records.map(r=>updates[r.id]&&updates[r.id].version>r.data.version?{...r,data:updates[r.id]}:r);
 const data=assignmentGroups(current,projects,context.staffId,now),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),lock=useRef(false);
 const act:Action=async command=>{if(lock.current)return null;lock.current=true;setBusy(true);setError('');setNotice('');try{const result=await json<{id?:string;data?:Deliverable}>('/api/hq',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});if(result.id&&result.data){const {id,data}=result;setUpdates(old=>({...old,[id]:data}));}setNotice('Deliverable updated.');window.dispatchEvent(new Event('hq-records-changed'));return result;}catch(e){setError((e as Error).message);return null;}finally{lock.current=false;setBusy(false);}};
 return <>{!compact&&<HqSubnavigation tabs={assignmentTabs} active={tab} label="Assignment areas"/>}<section className="panel hq-assignments"><div className="section-title"><div><h2>{compact?'My Assignments':tab==='completed'?'Completed work':tab==='projects'?'My projects':'What I need to do'}</h2><p className="hq-meta">Priority first, then due date · Central time</p></div>{compact&&<Link href="/assignments">View all →</Link>}</div>
 {error&&<div role="alert"><p>{error}</p><Button variant="outline" onClick={()=>window.dispatchEvent(new Event('hq-records-changed'))}>Refresh assignments</Button></div>}{notice&&<p role="status" className="hq-meta">{notice}</p>}
 {(compact||tab==='active')&&!data.groups.some(g=>g.id!=='complete')&&<div className="hq-empty"><h3>You’re caught up.</h3><p>No open deliverables assigned to you. <Link href="/projects">Explore projects</Link></p></div>}
 {data.groups.filter(g=>compact?g.id!=='complete':tab==='active'?g.id!=='complete':tab==='completed'?g.id==='complete':false).map(group=><section key={group.id} className="hq-assignment-group"><h3>{group.label} <span className="hq-count">{group.records.length}</span></h3><ul className="hq-work-list">{group.records.slice(0,compact?3:undefined).map(r=><HqWorkItem key={r.id+':'+r.data.version} record={r} now={now} project={projects.find(p=>p.id===r.data.projectId)} context={context} act={act} busy={busy}/>)}</ul>{compact&&group.records.length>3&&<Link className="hq-more" href="/assignments">View all {group.records.length} {group.label.toLowerCase()} →</Link>}</section>)}
 {!compact&&tab==='projects'&&<><ul className="hq-project-links">{data.projects.map(p=><li key={p.id}><Link href={'/projects/'+p.id}>{p.data.title}</Link><span className="hq-meta">Owner: {primaryOwnerLabel(p.data.owner,context.staff)}</span></li>)}</ul>{!data.projects.length&&<p className="hq-meta">No projects assigned to you yet.</p>}</>}
 {!compact&&tab==='completed'&&!data.groups.some(g=>g.id==='complete')&&<p className="hq-meta">No recently completed work.</p>}
 </section></>;
}
