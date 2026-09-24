'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {StoreOpeningMilestone} from '@/components/store-opening-milestone';
import {StoreOpenForm,type ChecklistEditor} from '@/components/store-open-form';
import {HqWorkItem} from '@/components/hq-work-item';
import type {Asset} from '@/components/hq-materials';
import {loadWorkspace,json,notifyWorkspaceChanged,type Workspace} from '@/lib/hq-client';
import {projectStatuses} from '@/lib/hq-model';
import {canManageTask,taskPriorities} from '@/lib/project-tasks';
import {checklistWork,checklistGroup,checklistTiming,type ChecklistItem} from '@/lib/store-open-work';
import {STORE_OPEN_CHECKLIST_HREF} from '@/lib/store-opening';
import {calendarDay,calendarTime} from '@/lib/content-calendar';

export function StoreOpenChecklist() {
 const params=useSearchParams(),requested=params.get('view'),view=requested==='departments'||requested==='completed'?requested:'active';
 const [workspace,setWorkspace]=useState<Workspace>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editor,setEditor]=useState<ChecklistEditor>(),[search,setSearch]=useState(''),[groupBy,setGroupBy]=useState<'department'|'owner'>('department'),[page,setPage]=useState(0);
 const editing=useRef(false),saving=useRef(false),generation=useRef(0),mounted=useRef(true);
 const refresh=useCallback(async()=>{const version=++generation.current;const next=await loadWorkspace();if(mounted.current&&version===generation.current){setWorkspace(next);setError('');}},[]);
 useEffect(()=>{mounted.current=true;const reload=()=>{if(!editing.current&&!saving.current)void refresh().catch(e=>{if(mounted.current)setError(e.message);});};reload();const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('northside-hq-records'):null;channel?.addEventListener('message',reload);window.addEventListener('focus',reload);window.addEventListener('hq-records-changed',reload);const timer=window.setInterval(reload,60000);return()=>{mounted.current=false;window.clearInterval(timer);channel?.close();window.removeEventListener('focus',reload);window.removeEventListener('hq-records-changed',reload);};},[refresh]);
 function edit(value?:ChecklistEditor){editing.current=!!value;setEditor(value);}
 async function act(command:Record<string,unknown>){if(saving.current)return null;saving.current=true;setBusy(true);try{const saved=await json<{id?:string}>('/api/hq',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});await refresh();notifyWorkspaceChanged();toast.success('Saved');return saved;}catch(e){setError((e as Error).message);return null;}finally{saving.current=false;setBusy(false);}}
 const model=checklistWork(workspace?.records||[]),c=workspace?.context,name=(id:string)=>c?.staff.find(s=>s.id===id)?.name||id||'Unassigned';
 const assets=(workspace?.records.filter(r=>r.kind==='asset')||[]) as Asset[];
 const query=search.toLowerCase().trim(),filtered=model.items.filter(i=>(view==='completed'?i.complete:!i.complete)&&(!query||[i.record.data.title,i.department,name(i.owner),i.kind==='deliverable'?i.parent?.data.title:''].join(' ').toLowerCase().includes(query)));
 const pageCount=Math.max(1,Math.ceil(filtered.length/12)),currentPage=Math.min(page,pageCount-1),visible=filtered.slice(currentPage*12,currentPage*12+12);
 const groups=new Map<string,ChecklistItem[]>();
 for(const item of visible){const label=view==='departments'?checklistGroup(item,groupBy,name):item.kind==='project'?item.record.data.title:item.parent?.data.title||'Direct checklist deliverables';groups.set(label,[...(groups.get(label)||[]),item]);}
 const departments=[...new Set(model.items.map(i=>i.department).filter(Boolean))].sort();
 const heading=useRef<HTMLHeadingElement>(null);
 return <div className="store-open-work">
 <StoreOpeningMilestone><div className="button-row"><Button disabled={!c||!!editor||busy} onClick={()=>edit({kind:'project'})}>Add Project</Button><Button variant="outline" disabled={!c||!!editor||busy} onClick={()=>edit({kind:'deliverable'})}>Add Deliverable</Button></div></StoreOpeningMilestone>
 {error&&<div role="alert" className="callout"><p>{error}</p><Button variant="outline" onClick={()=>void refresh().catch(e=>setError(e.message))}>Reload checklist</Button></div>}
 {!workspace?<p role="status">Loading checklist…</p>:<>
 <section className="panel store-open-progress" aria-label="Checklist progress"><div><span>Overall completion</span><strong>{model.percent}%</strong><progress aria-label="Overall completion" max={100} value={model.percent}/><small>{model.items.length} projects and deliverables</small></div><div><span>Open items</span><strong>{model.open}</strong></div><div><span>Completed items</span><strong>{model.completed}</strong></div></section>
 {editor&&<StoreOpenForm editor={editor} projects={model.projects} departments={departments} context={c!} assets={assets} busy={busy} act={act} onClose={()=>edit()}/>}
 <div className="store-open-toolbar"><nav aria-label="Checklist views" className="button-row">{[['active','Active'],['departments','By Department'],['completed','Completed']].map(([id,label])=><Link key={id} scroll={false} aria-current={view===id?'page':undefined} className={'store-open-view'+(view===id?' is-active':'')} href={STORE_OPEN_CHECKLIST_HREF+'&view='+id} onClick={()=>setPage(0)}>{label}</Link>)}</nav><Link className="hq-meta" href={STORE_OPEN_CHECKLIST_HREF+'&view=plan'}>Opening strategy &amp; budget →</Link></div>
 <div className="filter-row"><label className="field"><span>Find checklist work</span><Input type="search" placeholder="Project, deliverable, department or owner" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>{view==='departments'&&<label className="field"><span>Group by</span><select value={groupBy} onChange={e=>{setGroupBy(e.target.value as 'department'|'owner');setPage(0);}}><option value="department">Department / category</option><option value="owner">Responsible owner</option></select></label>}</div>
 <h3 ref={heading} tabIndex={-1} className="sr-only">{view==='completed'?'Completed':'Active'} checklist work</h3>
 <p className="hq-meta">{view==='completed'?'Completed projects and deliverables.':'Work to finish before opening. Missing deadlines and dates after opening are flagged.'}</p>
 {!filtered.length&&<p className="panel empty-small">{query?'No checklist work matches your search.':view==='completed'?'No completed items yet.':model.items.length?'All checklist items are complete.':'Add a project or a deliverable to start the store opening checklist.'}</p>}
 {[...groups.entries()].sort(([a],[b])=>view==='departments'?a.localeCompare(b):0).map(([label,items])=><section key={label} className="panel store-open-group" aria-label={label}><h3>{label}</h3><ul className="hq-work-list">{items.map(item=>{const timing=!item.complete&&checklistTiming(item);return item.kind==='deliverable'?<HqWorkItem key={'deliverable-'+item.record.id} record={item.record} project={item.parent} context={c!} act={act} busy={busy||!!editor} statusControl assets={assets} notice={[timing,item.parent&&['completed','archived'].includes(item.parent.data.status)&&!item.complete?'Reopen the project to update this deliverable.':''].filter(Boolean).join(' · ')||undefined} onEdit={item.record.data.workflow==='task'&&canManageTask(item.record.data,item.parent?.data,c!)&&!['completed','archived'].includes(item.parent?.data.status||'')?()=>edit({kind:'deliverable',record:item.record}):undefined}/>:<li key={'project-'+item.record.id} className="hq-work-item"><div className="hq-work-copy"><Link className="hq-work-title" href={'/projects/'+item.record.id+'?tab=overview'}>{item.record.data.title}</Link><p className="hq-meta">Project · {item.department||'Owner'} · {name(item.owner)}</p><p className="hq-work-date">{item.due?calendarDay(item.due)+' · '+calendarTime(item.due):'No deadline'}{timing&&<strong> · {timing}</strong>}</p><Link href={'/projects/'+item.record.id+'?tab=deliverables'}>Open deliverables →</Link></div><div className="hq-work-actions"><span className="tag">{projectStatuses[item.record.data.status]}</span><span className="hq-meta">{taskPriorities[item.record.data.priority||'normal']} priority</span><div className="button-row">{!item.complete&&<Button disabled={busy||!!editor} variant="outline" onClick={()=>edit({kind:'deliverable',projectId:item.record.id})}>Add deliverable</Button>}{(c!.admin||item.owner===c!.staffId)&&<Button disabled={busy||!!editor} variant="outline" aria-label={'Edit project: '+item.record.data.title} onClick={()=>edit({kind:'project',record:item.record})}>Edit project</Button>}</div></div></li>;})}</ul></section>)}
 {pageCount>1&&<div className="button-row"><Button variant="outline" disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);heading.current?.focus();}}>Previous</Button><span>Page {currentPage+1} of {pageCount}</span><Button variant="outline" disabled={currentPage+1===pageCount} onClick={()=>{setPage(currentPage+1);heading.current?.focus();}}>Next</Button></div>}
 </>}
 </div>;
}
