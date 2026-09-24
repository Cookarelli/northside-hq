'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {BudgetFields} from '@/components/deliverable-budget';
import {parseUsd,usdInput} from '@/lib/deliverable-budget';
import {StaffPicker} from '@/components/staff-picker';
import {MaterialsEditor,type Asset} from '@/components/hq-materials';
import {auctionEditorCommand} from '@/lib/auction-deliverables';
import {canManageTask,taskPriorities,type TaskPriority} from '@/lib/project-tasks';
import {deliverableDraft,destinations,type Deliverable,type DeliverableInput,type HqContext,type HqRecord,type Project} from '@/lib/hq-model';
import type {Action} from '@/components/hq-workspace';

export function AuctionDeliverableEditor({record,project,context,assets,busy,act,onClose}:{record:HqRecord<Deliverable>;project:Project;context:HqContext;assets:Asset[];busy:boolean;act:Action;onClose:()=>void}) {
 const titleRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{const previous=document.activeElement;titleRef.current?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 const d=record.data,[data,setData]=useState(()=>deliverableDraft(d)),[priority,setPriority]=useState<TaskPriority>(d.priority||'normal'),[notes,setNotes]=useState(d.notes||''),[planned,setPlanned]=useState(usdInput(d.plannedBudgetCents)),[actual,setActual]=useState(usdInput(d.actualSpendCents)),[pending,setPending]=useState(false),[error,setError]=useState('');
 const manager=canManageTask(d,project,context),locked=d.platforms.some(p=>['scheduled','published'].includes(d.publications[p]?.status));
 const update=(patch:Partial<DeliverableInput>)=>setData(old=>({...old,...patch}));
 const due=(value:string)=>update({productionDue:value,...(data.publishAt===data.productionDue?{publishAt:value}:{})});
 const staffOptions=Object.fromEntries(context.staff.map(person=>[person.id,person.name]));
 if(data.owner&&!staffOptions[data.owner])staffOptions[data.owner]=data.owner+' (inactive)';
 return <form className="hq-auction-editor hq-form" aria-label={'Edit '+d.title} onSubmit={async e=>{
  e.preventDefault();if(pending)return;setError('');
  let budget;try{budget={plannedBudgetCents:parseUsd(planned),actualSpendCents:parseUsd(actual)};}catch(e){setError((e as Error).message);return;}
  const parsed=auctionEditorCommand.safeParse({budget,action:'save-auction-deliverable',id:record.id,version:d.version,data,metadata:{priority,notes}});
  if(!parsed.success){setError(parsed.error.issues[0].message);return;}
  if(await act(parsed.data))onClose();else setError('Your changes are still here. Resolve the message above before saving again.');
 }}>
  <div className="section-title"><h4>Edit deliverable</h4><Button type="button" variant="outline" disabled={busy||pending} onClick={onClose}>Close editor</Button></div>
  {locked&&<p className="notice">Content is locked by a platform confirmation. Cancel scheduled posts in Status before editing. Published records retain their history; priority and internal notes remain editable by the project owner or an administrator.</p>}
  <fieldset disabled={busy||locked} className="campaign-fields">
   <label className="field"><span>Title</span><Input ref={titleRef} required maxLength={300} value={data.title} onChange={e=>update({title:e.target.value})}/></label>
   <label className="field"><span>Description</span><Textarea rows={4} maxLength={12000} value={data.instructions} onChange={e=>update({instructions:e.target.value})}/></label>
   <div className="two-fields"><label className="field"><span>Owner</span><select required value={data.owner} disabled={!manager} onChange={e=>update({owner:e.target.value,contributors:data.contributors.filter(id=>id!==e.target.value)})}><option value="">Choose an owner</option>{Object.entries(staffOptions).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <label className="field"><span>Auction / lot link</span><Input type="url" placeholder="https://…" maxLength={2000} value={data.destinationUrl} onChange={e=>update({destinationUrl:e.target.value})}/></label></div>
   <StaffPicker label="Additional assignees" value={data.contributors} onChange={contributors=>update({contributors})} staff={context.staff.filter(s=>s.id!==data.owner)} disabled={!manager}/>
   {!manager&&<p className="hq-meta">The project owner or an administrator manages ownership, assignees, priority, and internal notes.</p>}
   <div className="two-fields"><label className="field"><span>Due date (America/Chicago)</span><Input type="date" required value={data.productionDue.slice(0,10)} onChange={e=>due(e.target.value?e.target.value+'T'+(data.productionDue.slice(11,16)||'21:00'):'')}/></label><label className="field"><span>Due time (America/Chicago)</span><Input type="time" required disabled={!data.productionDue} value={data.productionDue.slice(11,16)} onChange={e=>due(data.productionDue.slice(0,10)+'T'+e.target.value)}/></label></div>
   <p className="hq-meta">When due and target publish times match, changing the due time moves both together.</p>
   <MaterialsEditor value={data} onChange={update} available={assets} onPendingChange={setPending}/>
   <details className="hq-details"><summary>Publishing copy and settings</summary><div className="campaign-fields">
    <label className="field"><span>Caption / publishing copy</span><Textarea rows={4} maxLength={12000} value={data.caption} onChange={e=>update({caption:e.target.value})}/></label>
    <div className="two-fields"><label className="field"><span>Target publish time (America/Chicago)</span><Input type="datetime-local" value={data.publishAt} onChange={e=>update({publishAt:e.target.value})}/></label><label className="field"><span>Format</span><Input value={data.format} onChange={e=>update({format:e.target.value})}/></label></div>
    <div className="two-fields"><label className="field"><span>Publisher</span><select disabled={!manager} value={data.publisher} onChange={e=>update({publisher:e.target.value})}><option value="">Choose a publisher</option>{context.staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="field"><span>Effort</span><select value={data.effort} onChange={e=>update({effort:e.target.value as DeliverableInput['effort']})}><option value="">Choose effort</option><option value="quick">Quick</option><option value="standard">Standard</option><option value="premium">Premium</option></select></label></div>
    <fieldset className="hq-checks"><legend>Platforms</legend>{destinations.map(platform=><label key={platform}><input type="checkbox" checked={data.platforms.includes(platform)} onChange={e=>update({platforms:e.target.checked?[...data.platforms,platform]:data.platforms.filter(p=>p!==platform)})}/>{platform}</label>)}</fieldset>
   </div></details>
  </fieldset>
  <fieldset disabled={busy||!manager} className="campaign-fields">
   <label className="field"><span>Priority</span><select value={priority} onChange={e=>setPriority(e.target.value as TaskPriority)}>{Object.entries(taskPriorities).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <label className="field"><span>Internal notes</span><Textarea rows={3} maxLength={12000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
  </fieldset>
  <BudgetFields actualFromEntries={!!d.auctionCampaignId||!!d.spendLedger} planned={planned} actual={actual} onPlanned={setPlanned} onActual={setActual} disabled={busy}/>
  {!locked&&<p className="hq-meta">Changes to content need fresh approval. Priority and notes do not change an approved publishing package.</p>}
  {error&&<p role="alert" className="notice error">{error}</p>}
  <div className="button-row"><Button type="submit" disabled={busy||pending}>{busy?'Saving…':'Save deliverable'}</Button><Button type="button" variant="outline" disabled={busy||pending} onClick={onClose}>Cancel</Button></div>
 </form>;
}
