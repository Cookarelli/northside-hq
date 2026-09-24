'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {json} from '@/lib/hq-client';
import {clientId} from '@/lib/client-id';
import {chicagoWall} from '@/lib/consignment';
import {calendarDay} from '@/lib/content-calendar';
import {compactUsd,spendChannels} from '@/lib/auction-finance';
import {parseUsd} from '@/lib/deliverable-budget';
import {canWork,recordedTime,type Deliverable,type HqContext,type HqRecord,type Project} from '@/lib/hq-model';
import type {SpendEntry} from '@/lib/hq-operations';
import {useHqClock} from '@/components/use-hq-clock';
import type {Action} from '@/components/hq-workspace';
type Spending={entries:SpendEntry[];nextOffset:number|null};
export function AuctionSpending({record,project,context,act,busy}:{record:HqRecord<Deliverable>;project:Project;context:HqContext;act:Action;busy:boolean}){
 const [spending,setSpending]=useState<Spending|null>(null),[error,setError]=useState(''),[amount,setAmount]=useState(''),[channel,setChannel]=useState<string>('Meta'),[date,setDate]=useState(''),[note,setNote]=useState(''),[reverse,setReverse]=useState<SpendEntry|null>(null),[reason,setReason]=useState(''),[pending,setPending]=useState(false);
 const attempt=useRef<{body:string;id:string}|null>(null),lock=useRef(false),now=useHqClock(),d=record.data;
 const fetchPage=useCallback((offset=0,signal?:AbortSignal)=>json<Spending>('/api/hq?kind=auction-spend&id='+encodeURIComponent(record.id)+'&offset='+offset,{signal}),[record.id]);
 useEffect(()=>{const controller=new AbortController();void fetchPage(0,controller.signal).then(setSpending).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[fetchPage,d.version]);
 const allowed=canWork(d,project,context)&&!d.deletedAt,today=now===null?'':chicagoWall(now).slice(0,10);
 async function save(fields:Record<string,unknown>){
  if(lock.current)return;lock.current=true;setPending(true);setError('');
  const body=JSON.stringify(fields);if(attempt.current?.body!==body)attempt.current={body,id:clientId()};
  try{if(await act({...fields,id:attempt.current.id,deliverableId:record.id,version:d.version})){setAmount('');setNote('');setReverse(null);setReason('');attempt.current=null;setSpending(await fetchPage());}else setError('Spending was not saved. Your entries are still here.');}
  catch(e){setError((e as Error).message);}finally{lock.current=false;setPending(false);}
 }
 return <section className="hq-auction-spending" aria-label={'Spending for '+d.title}>
  <div className="section-title"><h5>Spend by channel</h5><strong>Actual {d.actualSpendCents==null?'not recorded':compactUsd(d.actualSpendCents)}</strong></div>
  {!d.spendLedger&&!!d.actualSpendCents&&<p className="hq-meta">The previously recorded {compactUsd(d.actualSpendCents)} will be kept as a separate entry. New spending adds to that total.</p>}
  {allowed&&<form className="hq-form" onSubmit={e=>{e.preventDefault();try{const cents=parseUsd(amount);if(cents===null||cents===0)throw new Error('Enter an amount greater than zero.');void save({action:'auction-spend',channel,amountCents:cents,spentOn:date||today,note});}catch(e){setError((e as Error).message);}}}>
   <fieldset disabled={busy||pending} className="campaign-fields"><div className="hq-spend-fields"><label className="field"><span>Channel / cost type</span><select value={channel} onChange={e=>setChannel(e.target.value)}>{spendChannels.map(c=><option key={c}>{c}</option>)}</select></label><label className="field"><span>Amount (USD)</span><Input required inputMode="decimal" maxLength={13} value={amount} onChange={e=>setAmount(e.target.value)} placeholder="160.00"/></label><label className="field"><span>Spent on (Chicago)</span><Input required type="date" value={date||today} max={today||undefined} onChange={e=>setDate(e.target.value)}/></label></div><label className="field"><span>Note / invoice reference (optional)</span><Input maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label><div className="button-row"><Button type="submit">Add spend</Button>{d.actualSpendCents==null&&<Button type="button" variant="outline" onClick={()=>void act({action:'deliverable-budget',id:record.id,version:d.version,data:{plannedBudgetCents:d.plannedBudgetCents??null,actualSpendCents:0}})}>Confirm no spend</Button>}</div></fieldset>
  </form>}
  {error&&<p role="alert" className="notice error">{error}</p>}
  {reverse&&<form className="hq-form notice" onSubmit={e=>{e.preventDefault();void save({action:'auction-spend-reverse',reverses:reverse.id,note:reason});}}><p>Correct {compactUsd(reverse.amount_cents)} · {reverse.channel}. The original entry stays in history.</p><label className="field"><span>Correction reason</span><Input required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="button-row"><Button disabled={busy||pending}>Remove from total</Button><Button type="button" variant="outline" disabled={busy||pending} onClick={()=>setReverse(null)}>Cancel</Button></div></form>}
  <ul className="hq-spend-entries">{spending?.entries.map(e=><li key={e.id}><div><strong>{compactUsd(e.amount_cents)} · {e.channel}</strong><p className="hq-meta">{calendarDay(e.spent_on)}{e.reverses?' · Correction':e.reversed?' · Corrected':''}</p><p>{e.note}</p><small>{context.staff.find(s=>s.id===e.actor)?.name||e.actor} · {recordedTime(e.created_at)}</small></div>{allowed&&!e.reversed&&!e.reverses&&<Button variant="outline" disabled={busy||pending} onClick={()=>{setReverse(e);setReason('');}}>Correct</Button>}</li>)}</ul>
  {spending&&!spending.entries.length&&<p className="hq-meta">No channel entries yet.</p>}{!spending&&!error&&<p role="status">Loading spend entries…</p>}{spending?.nextOffset!=null&&<Button variant="outline" onClick={()=>void fetchPage(spending.nextOffset!).then(page=>setSpending({...page,entries:[...spending.entries,...page.entries]})).catch(e=>setError(e.message))}>Earlier entries</Button>}
 </section>;
}
