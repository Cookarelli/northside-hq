'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Switch} from '@/components/ui/switch';
import {CATEGORIES,PRIORITIES} from '@/lib/content-radar/model';
import type {Source,RadarData,RadarCommand} from '@/lib/content-radar/model';
import {freshness} from '@/lib/content-intelligence/model';
const time=(v:string|null)=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Never';
const states:Record<string,string>={pending:'Ready to check',manual:'Manual only',connected:'Connected',blocked:'Publisher blocked',error:'Needs attention'};
export function SourcePanel({sources,runs,disabled,onAdd,onLink,onRefresh,onSave}:{sources:Source[];runs:RadarData['runs'];disabled:boolean;onAdd:()=>void;onLink:(s:Source)=>void;onRefresh:(id?:string)=>Promise<void>;onSave:(c:RadarCommand)=>Promise<boolean>}){
 const [edit,setEdit]=useState<Source|null>(null),[error,setError]=useState('');
 return <>
 <section className="panel"><div className="section-title"><div><h2>Your hobby sources</h2><p className="muted">Collect publisher updates or save a social post for the team.</p></div><Button onClick={onAdd}>Add source</Button></div>
 <p className="muted">Refresh now checks enabled publisher sources. Instagram is a manual watchlist until an authorized API connection is available. Times are shown in Central Time.</p>
 <div className="radar-source-grid">{sources.map(s=><article className="radar-source-card" key={s.id}>
  <div className="radar-card-meta"><span className="tag">{states[s.connection_status]||s.connection_status}</span><span className="tag">{s.method==='discover'?'Discovery':s.method.toUpperCase()}</span>{!s.enabled&&<span className="tag">Paused</span>}<span className={'tag radar-priority-'+s.priority}>{s.priority}</span></div>
  <h3>{s.name}</h3><p className="muted">{s.category} · {freshness(s.last_success,s.cadence_minutes||1440)} · Every {s.cadence_minutes||1440} minutes</p><p className="muted">Last attempt: {time(s.last_attempt)}<br/>Last success: {time(s.last_success)}</p>
  {s.last_error&&<p className="radar-source-error">{s.last_error}</p>}
  {s.cursor&&<p className="muted">More entries are queued for the next refresh.</p>}
  {s.feed_url&&<a href={s.feed_url} target="_blank" rel="noopener noreferrer">View feed</a>}
  <div className="radar-actions"><a href={s.url} target="_blank" rel="noopener noreferrer">{s.url.includes('instagram.com/')?'Open profile':'Open source'}</a><Button variant="outline" disabled={disabled} onClick={()=>onLink(s)}>{s.url.includes('instagram.com/')?'Add post link':'Add story link'}</Button><Button variant="ghost" disabled={disabled} onClick={()=>{setError('');setEdit({...s});}}>Settings</Button>{s.method!=='manual'&&!!s.enabled&&<Button variant="ghost" disabled={disabled} onClick={()=>void onRefresh(s.id)}>Check source</Button>}</div>
 </article>)}</div>{!sources.length&&<p>No sources are available yet.</p>}</section>
 <section className="panel"><h2>Collection history</h2><p className="muted">Latest 30 runs. A failed publisher does not stop other sources.</p>{runs.length?<div className="radar-run-list">{runs.map(r=><article key={r.id}><div><strong>{r.source_name||'Manual link'}</strong><p className="muted">{time(r.started_at)} · {r.status}</p></div><p>{r.added} added · {r.duplicates} duplicates · {r.updates} publisher updates</p>{r.error&&<p className="radar-source-error">{r.error}</p>}</article>)}</div>:<p className="muted">Select Refresh now to collect the first publisher updates.</p>}</section>
 <Dialog open={!!edit} onOpenChange={v=>{if(!v)setEdit(null);}}><DialogContent className="radar-dialog"><DialogHeader><DialogTitle>Source settings</DialogTitle><DialogDescription>Your changes are retained when recommended sources are added again.</DialogDescription></DialogHeader>{edit&&<form onSubmit={async e=>{e.preventDefault();setError('');if(await onSave({action:'edit-source',id:edit.id,data:{name:edit.name,url:edit.url,category:edit.category as typeof CATEGORIES[number],priority:edit.priority,enabled:!!edit.enabled,mode:edit.method==='manual'?'manual':'discover',cadenceMinutes:edit.cadence_minutes||1440,allowPage:!!edit.allow_page,permissionNote:edit.permission_note||'',feedUrl:edit.feed_url||''}}))setEdit(null);else setError('Settings could not be saved. Your changes are kept here.');}}>
 <label className="field"><span>Name</span><Input required maxLength={150} value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label><label className="field"><span>URL</span><Input required type="url" maxLength={2048} value={edit.url} onChange={e=>setEdit({...edit,url:e.target.value})}/></label>
 <label className="field"><span>Category</span><Select value={edit.category} onValueChange={category=>setEdit({...edit,category})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{CATEGORIES.map(v=><SelectItem value={v} key={v}>{v}</SelectItem>)}</SelectContent></Select></label>
 <label className="field"><span>Priority</span><Select value={edit.priority} onValueChange={priority=>setEdit({...edit,priority:priority as Source['priority']})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{PRIORITIES.map(v=><SelectItem value={v} key={v}>{v}</SelectItem>)}</SelectContent></Select></label>
 <label className="field"><span>Collection</span><Select value={edit.method==='manual'?'manual':'discover'} onValueChange={method=>setEdit({...edit,method})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="manual">Manual links</SelectItem><SelectItem value="discover">Supported feed / permitted page</SelectItem></SelectContent></Select></label>
 <label className="field"><span>Publisher feed URL</span><Input type="url" maxLength={2048} value={edit.feed_url||''} onChange={e=>setEdit({...edit,feed_url:e.target.value})}/></label>
 <label className="field"><span>Collection cadence (minutes)</span><Input type="number" min={60} max={10080} required value={edit.cadence_minutes||1440} onChange={e=>setEdit({...edit,cadence_minutes:Number(e.target.value)})}/></label>
 <label className="radar-actions"><Switch checked={!!edit.allow_page} onCheckedChange={allow_page=>setEdit({...edit,allow_page})}/>Permitted publisher-page fallback</label>
 <label className="field"><span>Publisher permission / terms reference</span><Input required={!!edit.allow_page} minLength={edit.allow_page?10:0} maxLength={1000} value={edit.permission_note||''} onChange={e=>setEdit({...edit,permission_note:e.target.value})}/></label>
 <label className="radar-actions"><Switch checked={!!edit.enabled} onCheckedChange={enabled=>setEdit({...edit,enabled:Number(enabled)})}/>Enabled</label>{error&&<p role="alert">{error}</p>}<Button type="submit" disabled={disabled}>Save settings</Button>
 </form>}</DialogContent></Dialog>
 </>;
}
