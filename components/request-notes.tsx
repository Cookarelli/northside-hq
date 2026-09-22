'use client';

import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {FileText} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {json, type Action} from '@/components/hq-workspace';
import {recordedTime, type HqContext} from '@/lib/hq-model';
import {clientId} from '@/lib/client-id';

type Note = {id:string; actor:string; body:string; created_at:string};
type Activity = {id:string; actor:string; action:string; created_at:string; snapshot:{version?:number; decision?:{reason?:string}}};
type History = {comments:Note[]; activity:Activity[]; nextOffset:number|null};

export function RequestNotes({id,context,act,busy}:{id:string;context:HqContext;act:Action;busy:boolean}) {
  const inputId=useId();
  const [history,setHistory]=useState<History>({comments:[],activity:[],nextOffset:null});
  const [body,setBody]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const noteId=useRef(clientId()),lock=useRef(false),generation=useRef({value:0});
  const load=useCallback(async(offset=0)=>{
    const current=++generation.current.value;
    setLoading(true);
    try {
      const data=await json<History>('/api/hq?kind=request&id='+encodeURIComponent(id)+'&offset='+offset);
      if(current!==generation.current.value)return;
      setHistory(old=>offset?{comments:[...old.comments,...data.comments],activity:[...old.activity,...data.activity],nextOffset:data.nextOffset}:data);
      setError('');
    } catch(e) {if(current===generation.current.value)setError((e as Error).message);}
    finally {if(current===generation.current.value)setLoading(false);}
  },[id]);
  useEffect(()=>{const tracker=generation.current;const timer=setTimeout(()=>void load(),0);const changed=()=>void load();window.addEventListener('hq-records-changed',changed);return()=>{clearTimeout(timer);tracker.value++;window.removeEventListener('hq-records-changed',changed);};},[load]);
  const name=(actor:string)=>context.staff.find(staff=>staff.id===actor)?.name||'Staff member';
  async function save() {
    if(lock.current||busy||!body.trim())return;
    lock.current=true;setSaving(true);setNotice('');setError('');
    try {
      const result=await act({action:'comment',kind:'request',id,commentId:noteId.current,body,mentions:[]});
      if(!result){setError('Could not save your note. Your text is still here. Please retry.');return;}
      setBody('');noteId.current=clientId();setNotice('Note saved.');await load();
    } catch {setError('Could not save your note. Your text is still here. Please retry.');}
    finally {lock.current=false;setSaving(false);}
  }
  return <section className="panel request-notes" aria-labelledby="request-notes-title">
    <div className="section-title"><h2 id="request-notes-title">Notes</h2><span className="tag">Internal</span></div>
    <form onSubmit={e=>{e.preventDefault();void save();}} className="hq-form">
      <div className="field"><label htmlFor={inputId}>Add note</label><Textarea id={inputId} rows={3} maxLength={5000} required disabled={saving} value={body} onChange={e=>{setBody(e.target.value);noteId.current=clientId();setNotice('');}} placeholder="Add context, a blocker or handoff details."/></div>
      <div className="button-row"><Button type="submit" disabled={busy||saving||!body.trim()}>{saving?'Saving…':'Save note'}</Button>{notice&&<span role="status" className="muted">{notice}</span>}</div>
    </form>
    {error&&<div role="alert" className="notice error">{error} <Button type="button" variant="outline" disabled={loading} onClick={()=>void load()}>Reload notes</Button></div>}
    <div className="request-notes-history" aria-busy={loading}>
      {loading&&!history.comments.length?<p role="status">Loading notes…</p>:!error&&!history.comments.length?<p className="request-notes-empty"><FileText size={20} aria-hidden="true"/>No notes yet. Add context, status updates or handoff details here.</p>:null}
      {!!history.comments.length&&<><p className="muted">Newest first · Times in America/Chicago</p><ol className="hq-discussion request-note-list">{history.comments.map(note=><li key={note.id}><div className="request-note-meta"><span>{name(note.actor)}</span><time dateTime={note.created_at}>{recordedTime(note.created_at)}</time></div><p className="hq-preserve-text">{note.body}</p></li>)}</ol></>}
    </div>
    {!!history.activity.length&&<details className="hq-details"><summary>Request history</summary><ol className="hq-discussion">{history.activity.map(item=><li key={item.id}><div className="request-note-meta"><span>{name(item.actor)}</span><time dateTime={item.created_at}>{recordedTime(item.created_at)}</time></div><p>{item.action==='save-request'?(item.snapshot.version===1?'Request created':'Request updated'):item.action==='decide-request'?'Request decision recorded':item.action.replaceAll('-',' ')}{item.snapshot.decision?.reason?' · '+item.snapshot.decision.reason:''}</p></li>)}</ol></details>}
    {history.nextOffset!==null&&<Button variant="outline" disabled={loading} onClick={()=>void load(history.nextOffset!)}>Load earlier notes and history</Button>}
  </section>;
}
