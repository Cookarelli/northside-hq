'use client';

import {useMemo, useState} from 'react';
import {ClipboardList, MessageSquarePlus, Plus, Save} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {toast} from 'sonner';
import {clientId} from '@/lib/client-id';

export type RequestStatus = 'not-started' | 'in-progress' | 'needs-attention' | 'blocked' | 'complete';
export type RequestNote = {id:string; body:string; createdAt:string; author:string};
export type RequestData = {
  title:string;
  description:string;
  owner:string;
  dueDate:string;
  status:RequestStatus;
  notes:RequestNote[];
  createdAt:string;
  updatedAt:string;
};
export type RequestRecord = {id:string; data:RequestData};

const statusLabels:Record<RequestStatus,string>={
  'not-started':'Not Started',
  'in-progress':'In Progress',
  'needs-attention':'Needs Attention',
  'blocked':'Blocked',
  'complete':'Complete',
};

const emptyRequest=():RequestData=>({
  title:'',description:'',owner:'',dueDate:'',status:'not-started',notes:[],
  createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
});

export function RequestWorkflow({requests,busy,onSave}:{requests:RequestRecord[];busy:boolean;onSave:(id:string,data:RequestData)=>Promise<boolean>}) {
  const [draft,setDraft]=useState<RequestData>(emptyRequest);
  const [activeId,setActiveId]=useState<string|null>(requests[0]?.id||null);
  const [note,setNote]=useState('');
  const sorted=useMemo(()=>[...requests].sort((a,b)=>{
    const aDone=a.data.status==='complete',bDone=b.data.status==='complete';
    if(aDone!==bDone)return aDone?1:-1;
    const ad=a.data.dueDate||'9999-12-31',bd=b.data.dueDate||'9999-12-31';
    return ad.localeCompare(bd)||b.data.updatedAt.localeCompare(a.data.updatedAt);
  }),[requests]);
  const active=sorted.find(r=>r.id===activeId)||sorted[0];

  async function createRequest(){
    if(!draft.title.trim())return toast.error('Add a request title.');
    const now=new Date().toISOString();
    const data={...draft,title:draft.title.trim(),description:draft.description.trim(),owner:draft.owner.trim(),createdAt:now,updatedAt:now};
    const id=clientId();
    if(await onSave(id,data)){setDraft(emptyRequest());setActiveId(id);toast.success('Request added');}
  }

  async function updateActive(patch:Partial<RequestData>){
    if(!active)return;
    await onSave(active.id,{...active.data,...patch,updatedAt:new Date().toISOString()});
  }

  async function addNote(){
    if(!active||!note.trim())return;
    const entry:RequestNote={id:clientId(),body:note.trim(),createdAt:new Date().toISOString(),author:'Northside staff'};
    if(await onSave(active.id,{...active.data,notes:[...(active.data.notes||[]),entry],updatedAt:entry.createdAt})){
      setNote('');
      toast.success('Note added');
    }
  }

  return <section className="requests-workflow" aria-labelledby="requests-heading">
    <div className="section-heading">
      <div><p className="eyebrow">TEAM WORK</p><h2 id="requests-heading">Requests</h2><p className="section-description">Capture what needs to happen, assign ownership and keep internal notes with the request so handoffs stay in one place.</p></div>
    </div>

    <div className="request-layout">
      <div className="request-sidebar">
        <section className="panel request-create">
          <h3><Plus size={18}/> New request</h3>
          <label className="field"><span>Request</span><Input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder="What needs to be done?"/></label>
          <label className="field"><span>Details</span><Textarea rows={4} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder="Context, requirements or expected result"/></label>
          <div className="two-fields"><label className="field"><span>Owner</span><Input value={draft.owner} onChange={e=>setDraft({...draft,owner:e.target.value})} placeholder="Staff member"/></label>
          <label className="field"><span>Due date</span><Input type="date" value={draft.dueDate} onChange={e=>setDraft({...draft,dueDate:e.target.value})}/></label></div>
          <Button disabled={busy} onClick={createRequest}><Save size={18}/>{busy?'Saving…':'Add request'}</Button>
        </section>

        <div className="request-list" aria-label="Saved requests">
          {!sorted.length?<div className="panel empty"><ClipboardList size={24}/><h3>No requests yet</h3><p>Add the first team request to start tracking ownership, status and notes.</p></div>:
          sorted.map(r=><button type="button" key={r.id} className={'request-list-item '+(active?.id===r.id?'active':'')} onClick={()=>setActiveId(r.id)}>
            <span><b>{r.data.title}</b><small>{r.data.owner||'Unassigned'}{r.data.dueDate?' · '+r.data.dueDate:''}</small></span>
            <em data-status={r.data.status}>{statusLabels[r.data.status]}</em>
          </button>)}
        </div>
      </div>

      <div className="request-detail">
        {!active?<section className="panel empty request-empty"><h3>Select a request</h3><p>Choose a request from the list or create one to see its workflow and notes.</p></section>:
        <section className="panel request-detail-card">
          <div className="request-detail-header"><div><p className="eyebrow">REQUEST</p><h2>{active.data.title}</h2><p>{active.data.description||'No additional details yet.'}</p></div>
          <label className="field request-status"><span>Status</span><select value={active.data.status} disabled={busy} onChange={e=>void updateActive({status:e.target.value as RequestStatus})}>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
          <div className="request-meta">
            <label className="field"><span>Owner</span><Input value={active.data.owner} disabled={busy} onChange={e=>void updateActive({owner:e.target.value})}/></label>
            <label className="field"><span>Due date</span><Input type="date" value={active.data.dueDate} disabled={busy} onChange={e=>void updateActive({dueDate:e.target.value})}/></label>
          </div>

          <div className="request-notes">
            <div className="request-notes-heading"><div><p className="eyebrow">INTERNAL NOTES</p><h3>Context and handoff</h3></div><MessageSquarePlus size={22}/></div>
            <label className="field"><span>Add note</span><Textarea rows={4} value={note} onChange={e=>setNote(e.target.value)} placeholder="What changed, what is blocked, or what does the next person need to know?"/></label>
            <Button disabled={busy||!note.trim()} onClick={addNote}>Save note</Button>
            <div className="request-note-list">
              {!active.data.notes?.length?<div className="empty-small">No notes yet. Add context, status updates or handoff details here.</div>:
              [...active.data.notes].reverse().map(n=><article className="request-note" key={n.id}><p>{n.body}</p><small>{n.author} · {new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Chicago'}).format(new Date(n.createdAt))}</small></article>)}
            </div>
          </div>
        </section>}
      </div>
    </div>
  </section>;
}
