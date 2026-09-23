'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {json} from '@/lib/hq-client';
import {recordedTime} from '@/lib/hq-model';
type Notice={id:string;kind:'project'|'deliverable'|'request';record_id:string;message:string;category:string;created_at:string;read_at:string|null;resolved_at:string|null;metadata:{dueAt?:string;comment?:string}};
type Inbox={items:Notice[];unread:number;nextOffset:number|null};
export function HqNotifications(){
 const [open,setOpen]=useState(false),[inbox,setInbox]=useState<Inbox|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[checked,setChecked]=useState('');const lock=useRef(false);
 const readInbox=useCallback(async(check=true,offset=0)=>{const checkedAt=check?(await json<{checkedAt:string}>('/api/hq',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reminders'})})).checkedAt:null;const result=await json<Inbox>('/api/hq/notifications?offset='+offset);return {result,checkedAt,offset};},[]);
 const applyInbox=useCallback((value:Awaited<ReturnType<typeof readInbox>>)=>{if(!value)return;const {result,checkedAt,offset}=value;if(checkedAt)setChecked(checkedAt);setInbox(old=>offset&&old?{...result,items:[...old.items,...result.items]}:result);setError('');},[]);
 const refresh=useCallback(async(check=true,offset=0)=>{if(lock.current)return;lock.current=true;try{applyInbox(await readInbox(check,offset));}catch(e){setError((e as Error).message);}finally{lock.current=false;}},[readInbox,applyInbox]);
 useEffect(()=>{let active=true;void readInbox().then(value=>{if(active)applyInbox(value);}).catch(e=>{if(active)setError(e.message);});const visible=()=>{if(document.visibilityState==='visible')void refresh();};window.addEventListener('focus',visible);window.addEventListener('hq-records-changed',visible);const timer=setInterval(visible,60000);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',visible);window.removeEventListener('hq-records-changed',visible);};},[readInbox,applyInbox,refresh]);
 async function mark(n:Notice){if(busy||lock.current)return;setBusy(true);try{await json('/api/hq',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'notification-read',id:n.id,read:!n.read_at})});await refresh(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="hq-notifications"><Button variant="outline" aria-expanded={open} aria-controls="hq-notification-inbox" onClick={()=>{setOpen(!open);if(!open)void refresh();}}>Notifications{inbox?' ('+inbox.unread+' unread)':error?' · unavailable':''}</Button>
 {open&&<section id="hq-notification-inbox" className="panel hq-inbox" aria-label="My notifications"><div className="section-title"><h2>My notifications</h2><Button variant="outline" onClick={()=>setOpen(false)}>Close notifications</Button></div><p className="muted">Deadline reminders are checked while HQ is open. No background scheduler is configured; reminders do not run while the app is closed.</p><Button variant="outline" disabled={busy} onClick={()=>void refresh()}>Check reminders</Button>{checked&&<p className="muted">Last checked {recordedTime(checked)}</p>}{error&&<p role="alert">Notifications unavailable: {error}</p>}{!inbox&&!error&&<p role="status">Loading notifications…</p>}
 <ul className="hq-discussion">{inbox?.items.map(n=><li key={n.id}><Link href={(n.kind==='project'?'/projects/':n.kind==='deliverable'?'/projects/work/':'/requests/')+encodeURIComponent(n.record_id)}>{n.kind==='deliverable'?n.message.replace(/^Assigned as owner: /,'Assigned to you: '):n.message}</Link><time>{recordedTime(n.created_at)}</time>{n.resolved_at&&<p className="muted">No longer due for action</p>}{n.metadata.comment&&<p>{n.metadata.comment}</p>}<Button variant="outline" disabled={busy} onClick={()=>void mark(n)}>{n.read_at?'Mark unread':'Mark read'}</Button></li>)}</ul>
 {inbox&&!inbox.items.length&&<p>You have no notifications yet. Assignments, reviews, mentions and deadline checks will appear here.</p>}{inbox?.nextOffset!==null&&inbox?.nextOffset!==undefined&&<Button variant="outline" disabled={busy} onClick={()=>void refresh(false,inbox.nextOffset!)}>Load earlier notifications</Button>}
 </section>}
 </div>;
}
