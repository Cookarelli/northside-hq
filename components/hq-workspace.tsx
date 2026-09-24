'use client';
import {numberedAuctionName} from '@/lib/auction-campaigns';

import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import {activityLabel} from '@/lib/hq-presentation';
import {useRouter,useSearchParams} from 'next/navigation';
import {HqSubnavigation} from '@/components/hq-subnavigation';
import {selectedTab} from '@/lib/hq-tabs';
import {auctionNavigation,projectSections,projectTabHref} from '@/lib/hq-project-navigation';
import {AuctionViews} from '@/components/hq-auction-views';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {MaterialsEditor,ResourceLinks,AssignedContent,ProjectAssetList,type Asset} from '@/components/hq-materials';
import {StaffPicker} from '@/components/staff-picker';
import {StoreOpeningWarning} from '@/components/store-open-deadline';
import {STORE_OPEN_CHECKLIST_HREF} from '@/lib/store-opening';
import {ProjectTaskForm,TaskActions,DeliverableDetails} from '@/components/project-task';
import {canManageTask,primaryOwnerLabel,projectOwnerOptions,taskAssignees,urgencySort} from '@/lib/project-tasks';
import {useHqClock} from '@/components/use-hq-clock';
import {HqWorkItem} from '@/components/hq-work-item';
import {AuctionSpending} from '@/components/auction-spending';
import {DeliverableBudget} from '@/components/deliverable-budget';
import {isWeeklyAuctionHome,auctionRecordText,type AuctionCampaignData} from '@/lib/auction-campaigns';
import {HqProjectDeliverables} from '@/components/hq-project-deliverables';
import {HqPageActions} from '@/components/hq-page-actions';
import {HqStatus} from '@/components/hq-status';
import {HqProjectCard} from '@/components/hq-project-card';
import {HqCampaignContext,DeliverableTimestamps} from '@/components/hq-campaign-context';
import {HqSpending} from '@/components/hq-spending';
import {PublishingPackagePanel} from '@/components/hq-publishing-package';
import {ConsignmentReview} from '@/components/consignment-review';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import {clientId} from '@/lib/client-id';
import {approvalCurrent,auctionFor,blankDeliverable,blankProject,canWork,deliverableDraft,deliverableMissing,destinations,effortLevels,evidencePost,productionStatuses,projectDraft,projectMissing,projectStatuses,projectTypes,recordedTime,type Deliverable,type DeliverableInput,type HqContext,type HqRecord,type Project,type ProjectInput,type Staff,type WorkspaceRecord} from '@/lib/hq-model';

export type Action=(command:Record<string,unknown>)=>Promise<{id?:string}|null>;
import {json,loadWorkspace,notifyWorkspaceChanged,type Workspace} from '@/lib/hq-client';
export {json,loadWorkspace,type Workspace} from '@/lib/hq-client';

export const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export function dateLabel(value:string){return value?calendarDay(value)+' · '+calendarTime(value):'Not set';}
export function Field({label,children}:{label:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}</label>;}
export function Choice({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(v:string)=>void;options:Record<string,string>;disabled?:boolean}){return <Field label={label}><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}>{Object.entries(options).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field>;}
export function Person({label,value,onChange,staff,disabled=false}:{label:string;value:string;onChange:(v:string)=>void;staff:Staff[];disabled?:boolean}) {return <Choice label={label} value={value} onChange={onChange} disabled={disabled} options={{'':'Choose a person',...Object.fromEntries(staff.map(s=>[s.id,s.name])),...(value&&!staff.some(s=>s.id===value)?{[value]:value+' (inactive; reassign)'}:{})}}/>;}
export function Missing({items}:{items:string[]}) {return items.length?<div className="notice"><strong>Needs attention</strong><ul>{items.map(x=><li key={x}>{x}</li>)}</ul></div>:<p className="muted">Required information is complete.</p>;}

export function HqWorkspace({view='list',id,area='projects'}:{view?:'list'|'project'|'deliverable';id?:string;area?:string}) {
  const searchParams=useSearchParams(),now=useHqClock();
  const [workspace,setWorkspace]=useState<Workspace|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0),[create,setCreate]=useState<'project'|'deliverable'|'task'|null>(()=>searchParams.get('create')==='project'?'project':null);
  const generation=useRef(0),lock=useRef(false),errorRef=useRef<HTMLDivElement>(null),router=useRouter();
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  useEffect(()=>{const controller=new AbortController();loadWorkspace(controller.signal).then(setWorkspace).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[retry]);
  useEffect(()=>{
    if(view==='list')return;
    let active=true,loading=false;
    const editing=()=>!!document.querySelector('.hq-auction-editor,.hq-auction-settings,details[open]>form,form:focus-within');
    const refresh=async()=>{if(loading||lock.current||document.visibilityState!=='visible'||editing())return;loading=true;const start=generation.current;try{const next=await loadWorkspace();if(active&&!lock.current&&start===generation.current&&!editing())setWorkspace(next);}catch(e){if(active)setError((e as Error).message);}finally{loading=false;}};
    const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('northside-hq-records');if(channel)channel.onmessage=()=>void refresh();
    window.addEventListener('hq-records-changed',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);const timer=setInterval(refresh,30000);
    return()=>{active=false;clearInterval(timer);channel?.close();window.removeEventListener('hq-records-changed',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[view,id]);
  const act:Action=async command=>{
    if(lock.current)return null;generation.current++;lock.current=true;setBusy(true);setError('');setNotice('');
    try {const result=await json<{id?:string}>('/api/hq',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});setWorkspace(await loadWorkspace());setNotice('Saved.');notifyWorkspaceChanged();return result;}
    catch(e){setError((e as Error).message);return null;}finally{lock.current=false;setBusy(false);}
  };
  const reload=()=>{setError('');setRetry(n=>n+1);};
  if(!workspace)return <section className="panel">{error?<div role="alert"><p>{error}</p><Button onClick={reload}>Retry loading HQ</Button></div>:<p role="status">Loading projects and deliverables…</p>}</section>;
  const {context:c,records}=workspace;
  const projects=records.filter(r=>r.kind==='project') as HqRecord<Project>[],deliverables=records.filter(r=>r.kind==='deliverable') as HqRecord<Deliverable>[],assets=records.filter(r=>r.kind==='asset') as Asset[];
  const project=view==='project'?projects.find(p=>p.id===id):undefined,deliverable=view==='deliverable'?deliverables.find(d=>d.id===id):undefined;
  const campaigns=records.filter(r=>r.kind==='auction_campaign') as HqRecord<AuctionCampaignData>[];
  const weeklyHome=!!project&&isWeeklyAuctionHome(project,campaigns);
  const projectCampaigns=campaigns.filter(r=>r.data.projectId===project?.id);
  const auctions=auctionNavigation(projectCampaigns,now??0);
  const parent=deliverable?projects.find(p=>p.id===deliverable.data.projectId):project;
  const eligibleProjects=projects.filter(p=>!['completed','archived'].includes(p.data.status)&&(c.admin||p.data.owner===c.staffId||p.data.members.includes(c.staffId)));
  const tabs=project?projectSections(project,deliverables,assets,weeklyHome,eligibleProjects.some(p=>p.id===project.id),auctions.history.length>0,projectCampaigns):[];
  const projectTab=selectedTab(tabs,searchParams.get('tab'),searchParams.has('deliverable')?'deliverables':weeklyHome?'current-auction':deliverables.some(d=>d.data.projectId===project?.id&&!d.data.deletedAt)?'deliverables':'overview');
  const workTabs=[{id:'work',label:'Work'},...(deliverable&&(deliverable.data.assets.length||deliverable.data.references.length||assets.some(a=>a.data.assignedDeliverableId===deliverable.id))?[{id:'assets',label:'Assets'}]:[]),{id:'budget',label:'Budget'},...(deliverable?.data.publishing&&deliverable.data.workflow!=='task'?[{id:'publishing',label:'Publishing'}]:[]),...(deliverable?.data.editorialSource||deliverable?.data.legacyPost?[{id:'source',label:'Source review'}]:[]),{id:'notes',label:'Notes / Activity'}];
  const workTab=selectedTab(workTabs,searchParams.get('tab'),'work');
  const focusedCampaign=searchParams.get('deliverable')?undefined:projectCampaigns.find(c=>c.id===searchParams.get('auction'));
  const name=(staffId:string)=>c.staff.find(s=>s.id===staffId)?.name||staffId||'Unassigned';
  async function createRecord(command:Record<string,unknown>) {const result=await act(command);if(result?.id){setCreate(null);router.push(command.action==='save-project'?'/projects/'+result.id:'/projects/work/'+result.id);}}
  if(project?.data.migratedToProjectId) {
    const archivedTabs=[{id:'overview',label:'Original campaign'},{id:'notes',label:'Notes / Activity'}],archivedTab=selectedTab(archivedTabs,searchParams.get('tab'),'overview');
    const destination=projects.find(p=>p.id===project.data.migratedToProjectId);
    return <div className="hq-records"><Link href="/projects">← All projects and work</Link>
      {error&&<p role="alert" className="notice error">{error}</p>}{notice&&<p role="status">{notice}</p>}
      <h1>{project.data.title}</h1><HqSubnavigation tabs={archivedTabs} active={archivedTab} label="Archived project sections"/>
      {archivedTab==='overview'&&<><section className="panel"><p className="tag">Migrated · Archived</p>
        <p>This campaign is now managed as separate deliverables under <Link href={'/projects/'+encodeURIComponent(project.data.migratedToProjectId)+'?tab=deliverables'}>{destination?.data.title||'Collect Weekly Auctions'}</Link>.</p>
        {project.data.migratedAt&&<p className="hq-meta">Moved {recordedTime(project.data.migratedAt)}</p>}
        <ul>{deliverables.filter(d=>d.data.sourceProjectId===project.id).map(d=><li key={d.id}><Link href={projectTabHref(d.data.projectId,'deliverables',{deliverable:d.id})}>{d.data.title}</Link></li>)}</ul>
      </section>
      <section className="panel"><h2>Original campaign information</h2><p className="hq-preserve-text">{project.data.brief}</p><p>Original owner: {name(project.data.owner)} · Assigned staff: {project.data.members.map(name).join(', ')}</p><ResourceLinks {...project.data} available={assets}/></section></>}
      {archivedTab==='notes'&&<Discussion key={'discussion:'+project.data.version} id={project.id} kind="project" context={c} act={act} busy={busy}/>}
    </div>;
  }
  return <div className="hq-records">
    {view!=='list'&&((project?.data.storeOpenChecklist||deliverable?.data.storeOpenChecklist||parent?.data.storeOpenChecklist)?<nav aria-label="Breadcrumb" className="hq-breadcrumb"><Link href="/projects?tab=projects">Projects</Link><span aria-hidden="true">›</span><Link href={STORE_OPEN_CHECKLIST_HREF}>Store Open Checklist</Link><span aria-hidden="true">›</span><span aria-current="page">{deliverable?.data.title||project?.data.title}</span></nav>:<Link href="/projects">← All projects and work</Link>)}
    {error&&<div ref={errorRef} tabIndex={-1} role="alert" className="notice error"><p>{error}</p><Button variant="outline" onClick={reload}>Reload saved records</Button><p className="muted">Reload replaces the form with the saved version. Copy any unsaved changes first.</p></div>}
    {notice&&<p role="status" className="hq-save-notice">{notice}</p>}
    {view==='list'&&<>
      {['projects','deliverables'].includes(area)&&<><HqPageActions><div className="button-row">{area==='projects'&&<Button onClick={()=>setCreate('project')}>New Project</Button>}<Button variant={area==='deliverables'?'default':'ghost'} onClick={()=>setCreate('deliverable')}>New standalone work</Button></div></HqPageActions>
      {create==='project'&&<ProjectForm initial={{...blankProject,owner:Object.hasOwn(projectOwnerOptions(c.staff),c.staffId)?c.staffId:''}} context={c} assets={assets} busy={busy} onSave={createRecord} onCancel={()=>setCreate(null)}/>}
      {create==='deliverable'&&<DeliverableForm initial={{...blankDeliverable,owner:c.staffId}} context={c} projects={eligibleProjects} assets={assets} busy={busy} onSave={createRecord} onCancel={()=>setCreate(null)}/>}
      </>}
      {area==='projects'&&<ProjectList projects={projects} deliverables={deliverables} name={name}/>}
      {area==='deliverables'&&<section className="panel"><DeliverableList records={deliverables} projects={projects} context={c} act={act} busy={busy}/></section>}
      {area==='handoffs'&&<><LegacyAdoption records={records} context={c} act={act} busy={busy}/><EditorialHandoff records={records} context={c} act={act} busy={busy}/></>}
      {area==='permissions'&&(c.admin?<section className="panel"><h2>Workspace permissions</h2><h3>Budget approval</h3><p>Grant this separately from project ownership. Only these people can establish or change approved budgets.</p><div className="hq-checks">{c.staff.map(s=><label key={s.id}><input type="checkbox" checked={s.budgetApprover} disabled={busy} onChange={e=>void act({action:'permission',staffId:s.id,enabled:e.target.checked})}/>{s.name}</label>)}</div><h3>Request coordinators</h3><p>These people can accept or decline requests and link them to production work.</p><div className="hq-checks">{c.staff.map(s=><label key={s.id}><input type="checkbox" checked={!!s.requestCoordinator} disabled={busy} onChange={e=>void act({action:'permission',staffId:s.id,capability:'coordinate_requests',enabled:e.target.checked})}/>{s.name}</label>)}</div></section>:<p className="panel">Only administrators can manage workspace permissions.</p>)}
    </>}


    {view==='project' &&(project?<>
      <section className="hq-project-header"><p className="hq-meta">{projectTypes[project.data.type]}</p><h1>{weeklyHome?'Collect Weekly Auctions':project.data.title}</h1><div className="hq-header-meta"><span>Owner: <strong>{primaryOwnerLabel(project.data.owner,c.staff)}</strong></span><HqStatus>{projectStatuses[project.data.status]}</HqStatus>{!weeklyHome&&<span>Due: {dateLabel(project.data.eventAt||project.data.auctionClosesAt)}</span>}</div></section>
      <HqSubnavigation tabs={tabs} active={projectTab} label="Project sections"/>
      {weeklyHome&&['current-auction','auction-history','budget'].includes(projectTab)&&!(projectTab==='budget'&&searchParams.get('scope')==='project')&&<AuctionViews key={projectTab} area={projectTab as 'current-auction'|'auction-history'|'budget'} current={auctions.current} history={auctions.history} campaigns={projectCampaigns} selected={searchParams.get('auction')||''} records={deliverables} project={project} context={c} assets={assets} act={act} busy={busy}/>}
      {projectTab==='overview'&&<>
      {(c.admin||project.data.owner===c.staffId||(!project.data.owner&&project.data.createdBy===c.staffId))&&<details className="panel hq-details"><summary>Edit project</summary><ProjectForm key={project.data.version} record={project} initial={projectDraft(project.data)} context={c} assets={assets} busy={busy} onSave={async cmd=>{await act(cmd);}}/></details>}
      <section className="panel hq-project-people"><h2>Project owner and staff</h2><div className="two-fields"><div><p className="hq-meta">Primary owner</p><strong>{primaryOwnerLabel(project.data.owner,c.staff)}</strong></div><div><p className="hq-meta">Assigned staff</p><p>{project.data.members.map(name).join(', ')||'No staff assigned yet. Use Edit project to add people.'}</p></div></div></section>
      <section className="panel"><h2>Project information</h2><p className="hq-preserve-text">{project.data.brief||'No description yet.'}</p>{project.data.auctionOpensAt&&<p>Starts: {dateLabel(project.data.auctionOpensAt)}</p>}<Missing items={projectMissing(project.data)}/></section>
      {project.data.legacyCampaignId&&<p className="notice">Adopted campaign: original records are preserved as history. Dates, assignments and approvals are now managed here.</p>}
      <SourceRequests records={records} kind="project" id={project.id}/>
      </>}
      {projectTab==='deliverables'&&<>
      <section className="panel hq-deliverable-section"><div className="section-title"><h2>Deliverables</h2>{!weeklyHome&&eligibleProjects.some(p=>p.id===project.id)&&<div className="button-row"><Button onClick={()=>setCreate('task')}>Add deliverable</Button><Button variant="outline" onClick={()=>setCreate('deliverable')}>Add publishing work</Button></div>}</div>
        {create==='task'&&<ProjectTaskForm project={project} assets={assets} context={c} busy={busy} onSave={act} onCancel={()=>setCreate(null)}/>}
        {create==='deliverable'&&<DeliverableForm initial={{...blankDeliverable,owner:c.staffId,projectId:project.id}} context={c} projects={eligibleProjects} assets={assets} busy={busy} onSave={createRecord} onCancel={()=>setCreate(null)}/>}
        {weeklyHome&&<div className="button-row"><label className="field"><span>Auction</span><select value={focusedCampaign?.id||''} onChange={e=>router.push(projectTabHref(project.id,'deliverables',{auction:e.target.value}))}><option value="">All auctions</option>{[...projectCampaigns].sort((a,b)=>b.data.auction_number-a.data.auction_number).map(c=><option key={c.id} value={c.id}>{numberedAuctionName(c.data.name,c.data.auction_number)}</option>)}</select></label><Link href={projectTabHref(project.id,'current-auction')}>Current auction →</Link></div>}
        <HqProjectDeliverables focused={searchParams.get('deliverable')||''} campaigns={records.filter(r=>r.kind==='auction_campaign') as HqRecord<AuctionCampaignData>[]} assets={assets} records={deliverables.filter(d=>d.data.projectId===project.id&&(!focusedCampaign||d.data.auctionCampaignId===focusedCampaign.id))} project={project} context={c} act={act} busy={busy}/>
        {weeklyHome&&eligibleProjects.some(p=>p.id===project.id)&&<div className="button-row"><Button variant="outline" onClick={()=>setCreate('task')}>Add other deliverable</Button><Button variant="outline" onClick={()=>setCreate('deliverable')}>Add other publishing work</Button></div>}
      </section>
      {deliverables.some(d=>d.data.projectId===project.id&&d.data.deletedAt)&&<details className="panel hq-details"><summary>Deleted deliverables</summary><ul>{deliverables.filter(d=>d.data.projectId===project.id&&d.data.deletedAt).map(d=><li key={d.id}><Link href={'/projects/work/'+d.id}>{d.data.title}</Link></li>)}</ul></details>}
      </>}
      {projectTab==='assets'&&<section className="panel"><div className="section-title"><h2>Project files and links</h2><Link href="/assets?tab=jons-content">Jon&apos;s Content →</Link></div><ProjectAssetList project={project} deliverables={deliverables} available={assets}/>{projectCampaigns.filter(c=>c.data.assetLinks?.length).map(c=><article key={c.id}><h3>{numberedAuctionName(c.data.name,c.data.auction_number)}</h3><ul>{c.data.assetLinks!.map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></article>)}</section>}
      {projectTab==='budget'&&<>

      {weeklyHome&&<p><Link href={projectTabHref(project.id,'budget')+(searchParams.get('scope')==='project'?'':'&scope=project')}>{searchParams.get('scope')==='project'?'← Auction budgets & reconciliation':'Project-wide budget and spending →'}</Link></p>}
      {(!weeklyHome||searchParams.get('scope')==='project')&&<div className="hq-tab-panel"><BudgetPanel project={project} context={c} act={act} busy={busy} name={name}/><HqSpending project={project} context={c}/></div>}
      </>}
      {projectTab==='notes'&&<>
      <Discussion key={'discussion:'+project.data.version} id={project.id} kind="project" context={c} act={act} busy={busy}/>
      </>}
    </>:<p className="panel">This project was not found in your workspace.</p>)}
    {view==='deliverable'&&(deliverable?deliverable.data.deletedAt?<><h1>{deliverable.data.title}</h1><DeliverableDetails key={deliverable.data.version} record={deliverable} project={parent?.data} context={c} busy={busy} act={act}/><DeliverableTimestamps deliverable={deliverable.data}/></>:<>
      <div className="section-title hq-record-heading"><h1>{deliverable.data.title}</h1>{parent&&<Link href={projectTabHref(parent.id,'deliverables',{deliverable:deliverable.id})}>← {parent.data.title} · Deliverables</Link>}</div>
      <HqSubnavigation tabs={workTabs} active={workTab} label="Deliverable sections"/>
      {workTab==='work'&&<>
      <SourceRequests records={records} kind="deliverable" id={deliverable.id}/>
      {deliverable.data.workflow==='task'?<>
      <section className="panel"><h3>Work details</h3><p>{parent?'Primary project owner: ':'Owner: '}{parent?primaryOwnerLabel(parent.data.owner,c.staff):name(deliverable.data.owner)}</p><p>Assigned staff: {taskAssignees(deliverable.data).map(name).join(', ')}</p><p className="hq-preserve-text">{deliverable.data.instructions||'No description'}</p><p>Due: {dateLabel(deliverable.data.productionDue)}{deliverable.data.endAt?' → '+dateLabel(deliverable.data.endAt):''}</p></section>
      <TaskActions record={deliverable} project={parent?.data} context={c} busy={busy} act={act}/>
      {(parent||deliverable.data.storeOpenChecklist)&&!['completed','archived'].includes(parent?.data.status||'')&&canManageTask(deliverable.data,parent?.data,c)&&<><Button variant="outline" onClick={()=>setCreate('task')}>Edit deliverable</Button>{create==='task'&&<ProjectTaskForm key={deliverable.data.version} project={parent} assets={assets} record={deliverable} context={c} busy={busy} onSave={act} onCancel={()=>setCreate(null)}/>}</>}
      </>:<>
      <section className="panel"><p className="eyebrow">{parent?<Link href={projectTabHref(parent.id,'deliverables',{deliverable:deliverable.id})}>{parent.data.title}</Link>:'Standalone work'}</p><h3>Work details</h3><p>Accountable owner: {name(deliverable.data.owner)} · Approver: {name(parent?.data.owner||deliverable.data.approver)}</p><p className="hq-preserve-text">{deliverable.data.instructions||'Instructions not yet recorded.'}</p><p>Effort: {deliverable.data.effort?effortLevels[deliverable.data.effort]:'Unknown'}{deliverable.data.estimatedHours!==null?' · '+deliverable.data.estimatedHours+' estimated hours':''}</p><p>Contributors: {deliverable.data.contributors.map(name).join(', ')||'None'}</p>{deliverable.data.publishing&&<><p>Format: {deliverable.data.format||'Not set'}</p><p className="hq-preserve-text">{deliverable.data.caption}</p>{deliverable.data.destinationUrl&&<a href={deliverable.data.destinationUrl} target="_blank" rel="noreferrer">Destination link →</a>}</>}{deliverable.data.blocked&&<p>Resolve block: {name(deliverable.data.blockedBy)}</p>}<Missing items={deliverableMissing(deliverable.data,parent?.data)}/></section>
      <ProductionPanel record={deliverable} project={parent?.data} context={c} act={act} busy={busy} name={name}/>
      {canWork(deliverable.data,parent?.data,c)&&<details className="panel hq-details"><summary>Edit deliverable</summary>
        <DeliverableForm key={deliverable.data.version} record={deliverable} initial={deliverableDraft(deliverable.data)} project={parent?.data} context={c} projects={eligibleProjects} assets={assets} busy={busy} onSave={async cmd=>{await act(cmd);}}/>
      </details>}
      </>}
      <HqCampaignContext deliverable={deliverable.data}/>
      </>}
      {workTab==='assets'&&<section className="panel"><h2>Files and links</h2><ResourceLinks {...deliverable.data} available={assets}/><AssignedContent available={assets} kind="deliverable" id={deliverable.id} attached={deliverable.data.assets}/><Link href="/assets?tab=jons-content">Assign content →</Link></section>}
      {workTab==='budget'&&<>
      <DeliverableBudget key={deliverable.data.version} record={deliverable} project={parent?.data} context={c} busy={busy} act={act}/>
      {parent&&<Link href={projectTabHref(parent.id,'budget',{auction:deliverable.data.auctionCampaignId})}>Project budget &amp; spending →</Link>}
      {deliverable.data.auctionCampaignId&&parent&&<section className="panel"><AuctionSpending record={deliverable} project={parent.data} context={c} busy={busy} act={act}/></section>}
      </>}
      {workTab==='publishing'&&<>
      {deliverable.data.publishing&&<section className="panel"><h2>Publishing package</h2><PublishingPackagePanel deliverable={deliverable.data} project={parent?.data} assets={assets} name={name}/><h3>Manual publishing confirmations</h3><p>Record each destination after checking the actual platform. An intended date is never a scheduling or publishing confirmation.</p><div className="hq-project-grid">{deliverable.data.platforms.map(platform=><PublicationForm key={platform+deliverable.data.version} record={deliverable} project={parent?.data} platform={platform} context={c} act={act} busy={busy} name={name}/>)}</div></section>}
      </>}
      {workTab==='source'&&<>
      {deliverable.data.editorialSource&&<section className="panel"><h2>Editorial source review</h2><p>{deliverable.data.editorialSource.data.state} · source version {deliverable.data.editorialSource.version}</p><p>Compare the current source with this deliverable before owner approval. Source edits require renewed approval and never overwrite this production copy.</p><p className="hq-preserve-text">{deliverable.data.editorialSource.data.facebook}</p><p className="hq-preserve-text">{deliverable.data.editorialSource.data.instagram}</p><p>{deliverable.data.editorialSource.data.cta}</p><p>Media permission: {deliverable.data.editorialSource.data.permission} · {deliverable.data.editorialSource.data.attribution}</p><p>{deliverable.data.editorialSource.data.permissionEvidence}</p><Link href="/requests?tab=editorial">Open source review →</Link></section>}
      {deliverable.data.legacyPost&&<details className="panel hq-details"><summary>Preserved calendar history</summary><p>Historical status: <strong>{deliverable.data.legacyPost.status}</strong>. This is not an HQ approval or confirmation that any destination was published.</p><p>Original date: {dateLabel(deliverable.data.legacyPost.date)} · Historical owner: {deliverable.data.legacyPost.owner||'Unknown'}</p><p className="hq-preserve-text">{deliverable.data.legacyPost.caption}</p><p>Historical asset references: {deliverable.data.legacyPost.assets?.join(', ')||'None recorded'}</p></details>}
      </>}
      {workTab==='notes'&&<>
      <DeliverableDetails key={deliverable.data.version} record={deliverable} project={parent?.data} context={c} busy={busy} act={act}/>
      <Discussion key={'discussion:'+deliverable.data.version} id={deliverable.id} kind="deliverable" context={c} act={act} busy={busy}/>
      <DeliverableTimestamps deliverable={deliverable.data}/>
      </>}
    </>:<p className="panel">This deliverable was not found in your workspace.</p>)}
  </div>;
}

function ProjectList({projects,deliverables,name}:{projects:HqRecord<Project>[];deliverables:HqRecord<Deliverable>[];name:(id:string)=>string}) {
  const now=useHqClock(),[filter,setFilter]=useState('all'),[search,setSearch]=useState('');
  const shown=projects.filter(p=>(!p.data.migratedToProjectId||filter==='archived')&&(filter==='all'||p.data.status===filter)&&p.data.title.toLowerCase().includes(search.toLowerCase()));
  return <section><div className="two-fields"><Field label="Find a project"><Input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field><Choice label="Project status" value={filter} onChange={setFilter} options={{all:'All projects',...projectStatuses}}/></div><div className="hq-project-grid">{shown.map(p=><HqProjectCard key={p.id} project={p} deliverables={deliverables} name={name} now={now}/>)}</div>{!shown.length&&<p className="notice">{projects.length?'No projects match your search. Try a different name or status.':'No projects yet. Choose New Project above to get started.'}</p>}</section>;
}
function DeliverableList({records,projects,context,act,busy}:{records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];context:HqContext;act:Action;busy:boolean}) {
  const now=useHqClock();
  const [filter,setFilter]=useState('all');
  const shown=records.filter(r=>!r.data.deletedAt&&(filter==='all'||(filter==='standalone'?!r.data.projectId:filter==='waiting'?r.data.waiting:r.data.status===filter))).sort(urgencySort);
  return <><Choice label="Filter work" value={filter} onChange={setFilter} options={{all:'All work',standalone:'Standalone work',...productionStatuses,waiting:'Waiting'}}/><ul className="hq-work-list">{shown.map(r=><HqWorkItem key={r.id} record={r} now={now} project={projects.find(p=>p.id===r.data.projectId)} context={context} act={act} busy={busy}/>)}</ul>{!shown.length&&<p className="muted">No deliverables in this view.</p>}</>;
}

function ProjectForm({initial,record,context:c,assets,busy,onSave,onCancel}:{initial:ProjectInput;record?:HqRecord<Project>;context:HqContext;assets:Asset[];busy:boolean;onSave:(command:Record<string,unknown>)=>Promise<void>;onCancel?:()=>void}) {
  const titleRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(record)return;const previous=document.activeElement;titleRef.current?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[record]);
  const [pending,setPending]=useState(false);
  const [data,setData]=useState(initial),[id]=useState(()=>record?.id||clientId());
  const update=(patch:Partial<ProjectInput>)=>setData(d=>({...d,...patch}));
  return <form className="hq-form" onSubmit={e=>{e.preventDefault();if(pending)return;void onSave({action:'save-project',id,version:record?.data.version||0,data:{...data,references:data.references.filter(x=>x.trim())}});}}>
    {!record&&<h3>New project</h3>}<fieldset disabled={busy} className="campaign-fields">
      <Field label="Project title"><Input ref={titleRef} required maxLength={300} value={data.title} onChange={e=>update({title:e.target.value})}/></Field>
      <div className="two-fields"><Choice label="Project type" value={data.type} onChange={v=>update({type:v as ProjectInput['type']})} options={projectTypes}/><Choice label="Project status" value={data.status} onChange={v=>update({status:v as ProjectInput['status']})} options={projectStatuses}/></div>
      <Field label="Description"><Textarea required={data.status!=='draft'} rows={4} value={data.brief} onChange={e=>update({brief:e.target.value})}/></Field>
      <Field label="Primary owner"><select required value={data.owner} onChange={e=>update({owner:e.target.value})}>{Object.entries(data.storeOpenChecklist?Object.fromEntries(c.staff.map(s=>[s.id,s.name])):projectOwnerOptions(c.staff,record?.data.owner)).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field><p className="muted">One accountable owner. Assigned staff are selected separately below.</p><StaffPicker label="Assigned staff members" value={data.members} onChange={members=>update({members})} staff={c.staff}/>
      {(data.storeOpenChecklist||['event','product_release'].includes(data.type))&&<Field label={(data.storeOpenChecklist?'Due':data.type==='event'?'Event':'Release')+' date and time (America/Chicago)'}><Input type="datetime-local" required={data.status!=='draft'} value={data.eventAt} onChange={e=>update({eventAt:e.target.value})}/></Field>}
      {data.storeOpenChecklist&&<StoreOpeningWarning date={data.eventAt}/>}
      {data.storeOpenChecklist&&<div className="two-fields"><Field label="Department / category"><Input maxLength={100} value={data.department||''} onChange={e=>update({department:e.target.value})}/></Field><Choice label="Priority" value={data.priority||'normal'} onChange={v=>update({priority:v as ProjectInput['priority']})} options={{low:'Low',normal:'Normal',high:'High',urgent:'Urgent'}}/></div>}
      {data.type==='weekly_auction'&&<div className="two-fields"><Field label="Auction opening (America/Chicago)"><Input type="datetime-local" required={data.status!=='draft'} value={data.auctionOpensAt} onChange={e=>update({auctionOpensAt:e.target.value})}/></Field><Field label="Auction closing (America/Chicago)"><Input type="datetime-local" required={data.status!=='draft'} value={data.auctionClosesAt} onChange={e=>update({auctionClosesAt:e.target.value})}/></Field></div>}
      {data.auction&&<details className="hq-details"><summary>Auction facts and featured lots</summary><div className="campaign-fields"><Field label="Auction platform"><Input value={data.auction.auctionPlatform} onChange={e=>update({auction:{...data.auction!,auctionPlatform:e.target.value}})}/></Field><Field label="Auction batch link"><Input type="url" value={data.auction.batchUrl} onChange={e=>update({auction:{...data.auction!,batchUrl:e.target.value}})}/></Field>{data.auction.cards.map((card,index)=><div className="two-fields" key={index}><Field label={'Featured lot '+(index+1)+' name'}><Input value={card.name} onChange={e=>update({auction:{...data.auction!,cards:data.auction!.cards.map((x,i)=>i===index?{...x,name:e.target.value}:x)}})}/></Field><Field label={'Featured lot '+(index+1)+' URL'}><Input type="url" value={card.url} onChange={e=>update({auction:{...data.auction!,cards:data.auction!.cards.map((x,i)=>i===index?{...x,url:e.target.value}:x)}})}/></Field></div>)}</div></details>}
      <details className="hq-details"><summary>Links and resources (optional)</summary><MaterialsEditor value={data} onChange={update} available={assets} onPendingChange={setPending}/></details>
      {record&&<details className="hq-details"><summary>Channel allocations</summary><fieldset className="campaign-fields" disabled={record.data.owner!==c.staffId}><legend>Channel allocations (USD)</legend><p>{record.data.budget?money(record.data.budget.amountCents)+' approved':'Awaiting budget approval'} · {money(data.allocations.reduce((sum,x)=>sum+x.amountCents,0))} allocated</p>{data.allocations.map((a,index)=><div className="hq-allocation" key={index}><Field label={'Channel '+(index+1)}><Input required value={a.channel} onChange={e=>update({allocations:data.allocations.map((x,i)=>i===index?{...x,channel:e.target.value}:x)})}/></Field><Field label={'Allocation '+(index+1)+' (USD)'}><Input required type="number" min="0" step="0.01" value={a.amountCents/100} onChange={e=>update({allocations:data.allocations.map((x,i)=>i===index?{...x,amountCents:Math.round(Number(e.target.value)*100)}:x)})}/></Field><Button type="button" variant="outline" onClick={()=>update({allocations:data.allocations.filter((_,i)=>i!==index)})}>Remove channel {index+1}</Button></div>)}<Button type="button" variant="outline" onClick={()=>update({allocations:[...data.allocations,{channel:'',amountCents:0}]})}>Add channel allocation</Button></fieldset></details>}
      <p className="muted">Saving changes requires renewed approval for pending publishing work.</p><div className="button-row"><Button type="submit" disabled={pending}>{busy?'Saving…':record?'Save project':'Create project'}</Button>{onCancel&&<Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}</div>
    </fieldset>
  </form>;
}

function DeliverableForm({initial,record,project,context:c,projects,assets,busy,onSave,onCancel}:{initial:DeliverableInput;record?:HqRecord<Deliverable>;project?:Project;context:HqContext;projects:HqRecord<Project>[];assets:Asset[];busy:boolean;onSave:(command:Record<string,unknown>)=>Promise<void>;onCancel?:()=>void}) {
  const [pending,setPending]=useState(false);
  const [data,setData]=useState(initial),[id]=useState(()=>record?.id||clientId());
  const update=(patch:Partial<DeliverableInput>)=>setData(d=>({...d,...patch}));
  const canAssign=!record||c.admin||(project?.owner||record.data.approver)===c.staffId;
  const locked=!!record&&Object.values(record.data.publications).some(p=>p.status!=='planned');
  return <form className="hq-form" onSubmit={e=>{e.preventDefault();if(pending)return;void onSave({action:'save-deliverable',id,version:record?.data.version||0,data:{...data,references:data.references.filter(x=>x.trim())}});}}>
    {!record&&<h3>New deliverable</h3>}{locked&&<p className="notice">Confirmed destinations lock this content. Cancel actual platform scheduling and record that cancellation below before editing. Published work keeps its history; create a new deliverable for a follow-up.</p>}
    <fieldset disabled={busy||locked} className="campaign-fields">
      <Field label="Deliverable title"><Input required maxLength={300} value={data.title} onChange={e=>update({title:e.target.value})}/></Field>
      <Field label="Instructions"><Textarea rows={4} value={data.instructions} onChange={e=>update({instructions:e.target.value})}/></Field>
      <Choice label="Project association" value={data.projectId} onChange={projectId=>update({projectId,approver:projectId?'':data.approver})} disabled={!canAssign||!!record?.data.legacyPost?.consignment} options={{'':'Standalone work',...Object.fromEntries(projects.map(p=>[p.id,p.data.title])),...(record?.data.projectId&&!projects.some(p=>p.id===record.data.projectId)?{[record.data.projectId]:project?.title||'Current project'}:{})}}/>
      <div className="two-fields"><Person label="Accountable owner" value={data.owner} onChange={owner=>update({owner})} staff={c.staff} disabled={!canAssign}/>{!data.projectId&&<Person label="Standalone approver" value={data.approver} onChange={approver=>update({approver})} staff={c.staff} disabled={!canAssign}/>}</div>
      <StaffPicker label="Additional assigned staff" value={data.contributors} onChange={contributors=>update({contributors})} staff={c.staff} disabled={!canAssign}/>
      <div className="two-fields"><Field label="Production deadline (America/Chicago)"><Input type="datetime-local" value={data.productionDue} onChange={e=>update({productionDue:e.target.value})}/></Field><Choice label="Effort" value={data.effort} onChange={v=>update({effort:v as DeliverableInput['effort']})} options={{'':'Choose effort',...effortLevels}}/></div>
      {(record?.data.storeOpenChecklist||projects.find(p=>p.id===data.projectId)?.data.storeOpenChecklist||project?.storeOpenChecklist)&&<StoreOpeningWarning date={data.productionDue}/>}
      <Field label="Estimated hours (optional)"><Input type="number" min="0" max="10000" step="0.25" value={data.estimatedHours??''} onChange={e=>update({estimatedHours:e.target.value===''?null:Number(e.target.value)})}/></Field>
      <label className="check-field"><input type="checkbox" checked={data.publishing} onChange={e=>update({publishing:e.target.checked,platforms:e.target.checked?['facebook','instagram']:[],requiresCaption:e.target.checked,requiresFinalFile:e.target.checked,...(!e.target.checked?{promotionMode:'organic' as const,promotionChannel:'',promotionCents:0}:{})})}/><span>This work will be published</span></label>
      <fieldset className="hq-checks"><legend>Required output</legend><label><input type="checkbox" checked={data.requiresFinalFile} onChange={e=>update({requiresFinalFile:e.target.checked})}/>Final file or external final link</label>{data.publishing&&<label><input type="checkbox" checked={data.requiresCaption} onChange={e=>update({requiresCaption:e.target.checked})}/>Require caption / publishing copy</label>}</fieldset>
      {data.publishing&&<>
        <Person label="Assigned publisher" value={data.publisher} onChange={publisher=>update({publisher})} staff={c.staff} disabled={!canAssign}/>
        <Choice label="Promotion" value={data.promotionMode} onChange={v=>update({promotionMode:v as 'organic'|'paid',promotionChannel:'',promotionCents:0})} disabled={!!record&&!canAssign} options={{organic:'Organic · no paid budget required',paid:'Paid · approved project allocation'}}/>
        {data.promotionMode==='paid'&&<fieldset disabled={!!record&&!canAssign} className="two-fields"><Choice label="Approved promotion channel" value={data.promotionChannel} onChange={promotionChannel=>update({promotionChannel})} options={{'':'Choose an approved channel',...Object.fromEntries((projects.find(p=>p.id===data.projectId)?.data.allocations||project?.allocations||[]).map(a=>[a.channel,a.channel+' · '+money(a.amountCents)+' total']))}}/><Field label="Deliverable promotion allocation (USD)"><Input type="number" min="0.01" step="0.01" value={data.promotionCents/100} onChange={e=>update({promotionCents:Math.round(Number(e.target.value)*100)})}/></Field></fieldset>}
        <div className="two-fields"><Field label="Intended publication time (America/Chicago)"><Input type="datetime-local" value={data.publishAt} onChange={e=>update({publishAt:e.target.value})}/></Field><Field label="Format"><Input placeholder="Image, reel, email…" value={data.format} onChange={e=>update({format:e.target.value})}/></Field></div>
        <fieldset className="hq-checks"><legend>Destination platforms</legend>{destinations.map(p=><label key={p}><input type="checkbox" checked={data.platforms.includes(p)} onChange={e=>update({platforms:e.target.checked?[...data.platforms,p]:data.platforms.filter(x=>x!==p)})}/>{p}</label>)}</fieldset>
        <Field label="Caption / publishing copy"><Textarea rows={5} value={data.caption} onChange={e=>update({caption:e.target.value})}/></Field><Field label="Destination link (optional HTTPS)"><Input type="url" value={data.destinationUrl} onChange={e=>update({destinationUrl:e.target.value})}/></Field>
      </>}
      <label className="check-field"><input type="checkbox" checked={data.blocked} onChange={e=>update({blocked:e.target.checked})}/><span>This work is blocked</span></label>
      {data.blocked&&<><Field label="Blocked reason"><Textarea required value={data.blockedReason} onChange={e=>update({blockedReason:e.target.value})}/></Field><Person label="Responsible for resolving the block" value={data.blockedBy} onChange={blockedBy=>update({blockedBy})} staff={c.staff}/></>}
      <details className="hq-details"><summary>Links and resources (optional)</summary><MaterialsEditor value={data} onChange={update} available={assets} onPendingChange={setPending}/></details>
      {record?.data.legacyPost?.consignment&&project&&<ConsignmentReview data={evidencePost({...record.data,...data} as Deliverable)} campaign={auctionFor(project)} onChange={post=>update({caption:post.caption,evidence:{completedTasks:post.completedTasks,staffPicks:post.staffPicks,verification:post.verification}})}/>}
      <p className="muted">Saving content changes clears approval. Submit the updated version for review when it is ready.</p><div className="button-row"><Button type="submit" disabled={pending}>{busy?'Saving…':record?'Save deliverable':'Create deliverable'}</Button>{onCancel&&<Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}</div>
    </fieldset>
  </form>;
}

function BudgetPanel({project,context:c,act,busy,name}:{project:HqRecord<Project>;context:HqContext;act:Action;busy:boolean;name:(id:string)=>string}) {
  const [amount,setAmount]=useState('');const p=project.data;
  return <section className="panel"><h2>Approved budget</h2><p className="hq-budget">{p.budget?money(p.budget.amountCents):'Not approved'}</p>{p.budget&&<p className="muted">Approved by {name(p.budget.approvedBy)} · {recordedTime(p.budget.approvedAt)}</p>}
    <ul className="hq-deliverables">{p.allocations.map(a=><li key={a.channel}><span>{a.channel}</span><strong>{money(a.amountCents)}</strong></li>)}</ul><p>Unallocated: {p.budget?money(p.budget.amountCents-p.allocations.reduce((sum,a)=>sum+a.amountCents,0)):'Awaiting approval'}</p>
    {c.canApproveBudget?<form className="hq-form" onSubmit={async e=>{e.preventDefault();if(await act({action:'budget',id:project.id,version:p.version,amountCents:Math.round(Number(amount)*100)}))setAmount('');}}><Field label="New approved budget (USD)"><Input required type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} disabled={busy}/></Field><Button disabled={busy} type="submit">Approve budget amount</Button></form>:<p className="muted">Budget approvers: {c.staff.filter(s=>s.budgetApprover).map(s=>s.name).join(', ')||'Not configured; ask a workspace administrator'}</p>}
  </section>;
}
function ProductionPanel({record,project,context:c,act,busy,name}:{record:HqRecord<Deliverable>;project?:Project;context:HqContext;act:Action;busy:boolean;name:(id:string)=>string}) {
  const [comment,setComment]=useState('');
  const d=record.data,approver=project?.owner||d.approver,canApprove=canWork(d,project,c);
  const next:Record<Deliverable['status'],Deliverable['status'][]>= {to_do:['in_progress'],in_progress:['to_do','needs_review'],needs_review:['in_progress'],ready:['needs_review',...(d.publishing?[]:['done' as const])],done:['in_progress']};
  return <section className="panel"><h2>Production · {productionStatuses[d.status]}</h2><p>Deadline: {dateLabel(d.productionDue)}</p>{d.publishing&&<p>Intended publication: {dateLabel(d.publishAt)}</p>}
    {d.submission&&<p>Submitted by {name(d.submission.by)} to {name(d.submission.to)} · {recordedTime(d.submission.at)} · content version {d.submission.contentVersion}</p>}
    {d.approval&&<p className="muted">{approvalCurrent(d,project)?'Approved':'Prior approval — review again'} by {name(d.approval.by)} · {recordedTime(d.approval.at)} · reviewed version {d.approval.reviewedVersion||'not recorded'}</p>}
    {d.review?.comment&&<p className="notice">{d.review.decision==='changes'?'Changes requested':'Review note'}: {d.review.comment}</p>}
    {canWork(d,project,c)&&<div className="button-row">{next[d.status].map(status=><Button key={status} variant="outline" disabled={busy} onClick={()=>void act({action:'production',id:record.id,version:d.version,status})}>{status==='needs_review'?'Submit to '+name(approver)+' for review':'Move to '+productionStatuses[status]}</Button>)}</div>}
    {d.status==='needs_review'&&(canApprove?<form className="hq-form" onSubmit={async e=>{e.preventDefault();if(await act({action:'review',id:record.id,version:d.version,decision:'approve',comment}))setComment('');}}><Field label="Review comment (required for changes)"><Textarea maxLength={5000} value={comment} onChange={e=>setComment(e.target.value)}/></Field><div className="button-row"><Button type="submit" disabled={busy||deliverableMissing(d,project).length>0}>Approve this version · Ready</Button><Button type="button" variant="outline" disabled={busy||!comment.trim()} onClick={async()=>{if(await act({action:'review',id:record.id,version:d.version,decision:'changes',comment}))setComment('');}}>Request changes</Button></div></form>:<p className="muted">Waiting for {name(approver)} to review.</p>)}
  </section>;
}
function PublicationForm({record,project,platform,context:c,act,busy,name}:{record:HqRecord<Deliverable>;project?:Project;platform:string;context:HqContext;act:Action;busy:boolean;name:(id:string)=>string}) {
  const d=record.data,p=d.publications[platform];
  const [status,setStatus]=useState<'scheduled'|'published'|'planned'>('scheduled'),[time,setTime]=useState(''),[url,setUrl]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
  const eligible=canWork(d,project,c);
  return <article className="hq-publication"><h3>{platform}</h3><p className="tag">{p.status}</p>{p.scheduledFor&&<p>Scheduled for {dateLabel(p.scheduledFor)}<br/><span className="muted">Confirmed by {name(p.scheduledBy||'')}</span></p>}
    {p.status==='published'?<><p>Published {dateLabel(p.publishedAt||'')}<br/><span className="muted">Recorded by {name(p.recordedBy||'')}</span></p>{p.liveUrl?<a href={p.liveUrl} target="_blank" rel="noreferrer">Open live publication →</a>:<p>No live URL: {p.unavailableReason}</p>}</>:eligible?<form className="hq-form" onSubmit={e=>{e.preventDefault();void act({action:'publication',id:record.id,version:d.version,platform,status,time,url,unavailableReason:reason,confirmed});}}>
      <fieldset disabled={busy} className="campaign-fields"><Choice label={'Record '+platform+' action'} value={status} onChange={v=>{setStatus(v as typeof status);setConfirmed(false);setTime('');}} options={{scheduled:'Scheduled on the platform',published:'Published on the platform',...(p.status==='scheduled'?{planned:'Cancelled platform scheduling'}:{})}}/>
      {status!=='planned'&&<Field label={status==='published'?'Actual publication time (America/Chicago)':'Confirmed scheduled time (America/Chicago)'}><Input required type="datetime-local" value={time} onChange={e=>setTime(e.target.value)}/></Field>}
      {status==='published'&&<><Field label="Live publication URL"><Input type="url" value={url} onChange={e=>setUrl(e.target.value)}/></Field>{!url&&<Field label="Why is no live URL available?"><Textarea required minLength={5} value={reason} onChange={e=>setReason(e.target.value)}/></Field>}</>}
      <label className="check-field"><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{status==='scheduled'?'I confirmed this was scheduled on '+platform+'.':status==='published'?'I checked that this is live on '+platform+'.':'I cancelled the scheduled post on '+platform+'.'}</span></label>
      <Button type="submit" disabled={!confirmed||(status!=='planned'&&(d.status!=='ready'||d.blocked||!approvalCurrent(d,project)))}>Record {platform} confirmation</Button>
      {(d.status!=='ready'||!approvalCurrent(d,project))&&<p className="muted">Current approval is required to record scheduling or publication.</p>}
      </fieldset></form>:<p className="muted">Assigned deliverable staff, project members, or an administrator records publishing confirmations.</p>}
  </article>;
}

function LegacyAdoption({records,context:c,act,busy}:{records:WorkspaceRecord[];context:HqContext;act:Action;busy:boolean}) {
  const router=useRouter();
  const adoptedCampaigns=new Set(records.filter(r=>r.kind==='project').map(r=>(r.data as Project).legacyCampaignId)),adoptedPosts=new Set(records.filter(r=>r.kind==='deliverable').map(r=>(r.data as Deliverable).legacyPostId));
  const campaigns=records.filter(r=>r.kind==='campaign'&&!adoptedCampaigns.has(r.id)) as HqRecord<{name:string;owner?:string}>[];
  const posts=records.filter(r=>r.kind==='post'&&!adoptedPosts.has(r.id)&&!(r.data as {consignment?:unknown}).consignment&&!(r.data as {recurrence?:unknown}).recurrence&&!r.id.startsWith('radar_')) as HqRecord<{title:string;owner?:string}>[];
  return <details className="panel hq-details"><summary>Adopt existing campaigns and calendar posts</summary><p>Move work into HQ explicitly. Original records remain preserved as read-only history. Historical approvals and publishing labels require fresh confirmation.</p><p className="muted">Create a dated occurrence from a recurring template before adopting it. Editorial handoff is available below. Original data and attached media remain available.</p><ul className="hq-deliverables">{[...campaigns.map(r=>({...r,kind:'campaign',title:r.data.name})),...posts.map(r=>({...r,kind:'post',title:r.data.title}))].map(r=><li key={r.kind+r.id}><span>{r.title}</span><Button variant="outline" disabled={busy||(!c.admin&&r.data.owner!==c.staffId)} onClick={async()=>{const result=await act({action:r.kind==='campaign'?'adopt-campaign':'adopt-post',id:r.id});if(result?.id)router.push(r.kind==='campaign'?'/projects/'+result.id:'/projects/work/'+result.id);}}>Adopt {r.kind}</Button></li>)}</ul>{!campaigns.length&&!posts.length&&<p>No eligible legacy work remains.</p>}</details>;
}

function EditorialHandoff({records,context:c,act,busy}:{records:WorkspaceRecord[];context:HqContext;act:Action;busy:boolean}){
 const [owner,setOwner]=useState(''),[approver,setApprover]=useState(''),[effort,setEffort]=useState('standard');const router=useRouter();
 const adopted=new Set(records.filter(r=>r.kind==='deliverable').map(r=>(r.data as Deliverable).legacyPostId));const posts=records.filter(r=>r.kind==='post'&&(r.data as {radarId?:string}).radarId&&!adopted.has(r.id)) as HqRecord<{title:string;status:string}>[];
 return <details className="panel hq-details"><summary>Hand off approved editorial work</summary><p>Approved editorial sources can become one standalone HQ deliverable. Choose its accountable owner, approver and effort. The original remains available; instructions, committed deadlines, final files and publishing confirmation need explicit review in HQ.</p>{c.canCoordinate||c.admin?<><Person label="Editorial work owner" value={owner} onChange={setOwner} staff={c.staff}/><Person label="Editorial work approver" value={approver} onChange={setApprover} staff={c.staff}/><Choice label="Editorial work effort" value={effort} onChange={setEffort} options={effortLevels}/><ul className="hq-deliverables">{posts.map(p=><li key={p.id}><span>{p.data.title} · {p.data.status}</span><Button disabled={busy||!owner||!approver||p.data.status!=='approved'} onClick={async()=>{const result=await act({action:'adopt-editorial',id:p.id,owner,approver,effort});if(result?.id)router.push('/projects/work/'+result.id);}}>Hand off {p.data.title}</Button></li>)}</ul>{!posts.length&&<p>No editorial calendar copies await handoff. Approve the source and add it to the calendar in the editorial queue first.</p>}</>:<p>A request coordinator can hand off an approved editorial source.</p>}<Link href="/requests?tab=editorial">Open editorial queue →</Link></details>;
}

type Comment={id:string;actor:string;body:string;created_at:string;mentions?:string[]};
type Activity={id:string;record_id?:string;actor:string;action:string;created_at:string;snapshot:{version?:number;title?:string;approval?:{by:string};review?:{decision:'approve'|'changes';reviewedVersion:number};decision?:{reason:string};budget?:{amountCents:number};amount_cents?:number;category?:string;note?:string}};
export function Discussion({id,kind,context:c,act,busy}:{id:string;kind:'project'|'deliverable'|'request';context:HqContext;act:Action;busy:boolean}) {
  const [comments,setComments]=useState<Comment[]>([]),[activity,setActivity]=useState<Activity[]>([]),[next,setNext]=useState<number|null>(null),[error,setError]=useState(''),[body,setBody]=useState(''),[mentions,setMentions]=useState<string[]>([]),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  const commentId=useRef(clientId());
  useEffect(()=>{const refresh=()=>setRefresh(n=>n+1);window.addEventListener('hq-records-changed',refresh);return()=>window.removeEventListener('hq-records-changed',refresh);},[]);
  const load=useCallback(async(offset:number,signal?:AbortSignal)=>{try{const data=await json<{comments:Comment[];activity:Activity[];nextOffset:number|null}>('/api/hq?kind='+kind+'&id='+encodeURIComponent(id)+'&offset='+offset,{signal});setComments(old=>offset?[...old,...data.comments]:data.comments);setActivity(old=>offset?[...old,...data.activity]:data.activity);setNext(data.nextOffset);setError('');}catch(e){if(!signal?.aborted)setError((e as Error).message);}finally{if(!signal?.aborted)setLoading(false);}},[id,kind]);
  useEffect(()=>{const controller=new AbortController();json<{comments:Comment[];activity:Activity[];nextOffset:number|null}>('/api/hq?kind='+kind+'&id='+encodeURIComponent(id)+'&offset=0',{signal:controller.signal}).then(data=>{setComments(data.comments);setActivity(data.activity);setNext(data.nextOffset);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[id,kind,refresh]);
  const name=(staffId:string)=>c.staff.find(s=>s.id===staffId)?.name||staffId;
  return <section className="panel"><h2>Comments and activity</h2>{error&&<p role="alert">{error} <Button variant="outline" onClick={()=>setRefresh(n=>n+1)}>Retry history</Button></p>}
    <details className="hq-details"><summary>Add a comment</summary><form className="hq-form" onSubmit={async e=>{e.preventDefault();if(await act({action:'comment',id,kind,commentId:commentId.current,body,mentions})){setBody('');setMentions([]);commentId.current=clientId();setRefresh(n=>n+1);}}}><Field label="Add an internal comment"><Textarea required maxLength={5000} value={body} onChange={e=>{setBody(e.target.value);commentId.current=clientId();}}/></Field><StaffPicker label="Mention staff (notify in app)" value={mentions} onChange={people=>{setMentions(people);commentId.current=clientId();}} staff={c.staff}/><Button type="submit" disabled={busy}>Post comment</Button></form></details>
    <ul className="hq-discussion">{comments.map(x=><li key={x.id}><strong>{name(x.actor)}</strong><time>{recordedTime(x.created_at)}</time><p className="hq-preserve-text">{x.body}</p>{!!x.mentions?.length&&<p className="muted">Mentioned: {x.mentions.map(name).join(', ')}</p>}</li>)}</ul>
    <details className="hq-details" open><summary>Activity history</summary><ul className="hq-discussion">{activity.map(x=><li key={x.id}><strong>{name(x.actor)}</strong><time>{recordedTime(x.created_at)}</time><p>{activityLabel(x.action)}{x.snapshot.title?' · '+auctionRecordText(x.snapshot.title,x.record_id||id):''}{x.snapshot.version?' · version '+x.snapshot.version:''}{x.action==='review'&&x.snapshot.review?' · '+(x.snapshot.review.decision==='approve'?'Approved':'Changes requested')+' · reviewed version '+x.snapshot.review.reviewedVersion:''}{x.snapshot.amount_cents!==undefined?' · '+money(x.snapshot.amount_cents)+' '+x.snapshot.category+' · '+x.snapshot.note:''}{x.action==='decide-request'&&x.snapshot.decision?.reason?' · '+x.snapshot.decision.reason:''}</p></li>)}</ul></details>
    {loading&&<p role="status">Loading history…</p>}{next!==null&&<Button variant="outline" disabled={loading} onClick={()=>{setLoading(true);void load(next);}}>Load earlier comments and activity</Button>}
  </section>;
}

function SourceRequests({records,kind,id}:{records:WorkspaceRecord[];kind:string;id:string}) {
 const requests=records.filter(r=>r.kind==='request'&&(r.data as {conversion?:{kind:string;id:string}}).conversion?.kind===kind&&(r.data as {conversion?:{id:string}}).conversion?.id===id);
 return requests.length?<section className="panel"><h2>Original requests</h2><ul>{requests.map(r=><li key={r.id}><Link href={'/requests/'+r.id}>{(r.data as {title:string}).title}</Link><p className="muted">Requested deadline: {dateLabel((r.data as {requestedDeadline:string}).requestedDeadline)} · separate from the production commitment</p></li>)}</ul></section>:null;
}
