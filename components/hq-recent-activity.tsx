'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {recordActionHref} from '@/lib/hq-project-navigation';
import {activityLabel} from '@/lib/hq-presentation';
import {Button} from '@/components/ui/button';
import {json} from '@/lib/hq-client';
import {recordedTime,type Staff} from '@/lib/hq-model';
import {personName} from '@/lib/hq-operations';
type Activity={id:string;actor:string;kind:string;record_id:string;action:string;created_at:string;snapshot:{title?:string}};
export function HqRecentActivity({staff}:{staff:Staff[]}) {
 const [items,setItems]=useState<Activity[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();json<{activity:Activity[]}>('/api/hq?kind=activity',{signal:controller.signal}).then(data=>{setItems(data.activity);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});const refresh=()=>setRetry(n=>n+1);window.addEventListener('hq-records-changed',refresh);return()=>{controller.abort();window.removeEventListener('hq-records-changed',refresh);};},[retry]);
 return <section className="panel"><h2>Recent Activity</h2>{error?<p role="alert">Activity unavailable. <Button variant="outline" onClick={()=>setRetry(n=>n+1)}>Retry activity</Button></p>:items?<ul className="hq-discussion">{items.map(item=><li key={item.id}><Link href={recordActionHref(item.kind,item.record_id,item.action)}>{item.snapshot.title||'Open '+item.kind}</Link><p>{personName(item.actor,staff)} · {activityLabel(item.action)}</p><time>{recordedTime(item.created_at)}</time></li>)}</ul>:<p role="status">Loading activity…</p>}{items?.length===0&&<p className="muted">No activity recorded yet.</p>}</section>;
}
