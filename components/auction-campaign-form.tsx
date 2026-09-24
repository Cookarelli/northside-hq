'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {StaffPicker} from '@/components/staff-picker';
import {auctionCampaignCommand,createAuctionCampaignCommand,type AuctionCampaignData,type AuctionCampaignInput} from '@/lib/auction-campaigns';
import {parseUsd,usd,usdInput} from '@/lib/deliverable-budget';
import {scheduleWall} from '@/lib/consignment';
import {clientId} from '@/lib/client-id';
import type {HqContext,HqRecord} from '@/lib/hq-model';
import type {Action} from '@/components/hq-workspace';

const splitLinks=(value:string)=>[...new Set(value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean))];
const hours=['48','24','2'] as const;
export function AuctionCampaignForm({projectId,record,suggestedNumber,context,act,busy,onClose}:{projectId:string;record?:HqRecord<AuctionCampaignData>;suggestedNumber:number;context:HqContext;act:Action;busy:boolean;onClose:()=>void}){
 const initial=record?.data;
 const [id]=useState(()=>record?.id||clientId()),[name,setName]=useState(initial?.name||''),[number,setNumber]=useState(String(initial?.auction_number||suggestedNumber));
 const [close,setClose]=useState(initial?.closesAt?scheduleWall(initial.closesAt):''),[time,setTime]=useState(initial?.closesAt?scheduleWall(initial.closesAt).slice(11,16):'21:00');
 const [owner,setOwner]=useState(initial?.owner||context.staffId),[assignees,setAssignees]=useState(initial?.assignees||[]),[featuredCard,setFeaturedCard]=useState(initial?.featuredCard||'');
 const [platform,setPlatform]=useState(initial?.auctionPlatform||''),[auctionUrl,setAuctionUrl]=useState(initial?.auctionUrl||''),[lots,setLots]=useState(initial?.lotUrls?.join('\n')||''),[assets,setAssets]=useState(initial?.assetLinks?.join('\n')||''),[notes,setNotes]=useState(initial?.internalNotes||'');
 const [budget,setBudget]=useState(usdInput(initial?.campaignBudgetCents)),[allocations,setAllocations]=useState({'48':'','24':'','2':''}),[error,setError]=useState('');
 const nameRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{nameRef.current?.focus();},[]);
 let balance='';try{const target=parseUsd(budget);const total=hours.reduce((sum,h)=>sum+BigInt(parseUsd(allocations[h])||0),BigInt(0));if(target!==null){const difference=BigInt(target)-total;balance=`Allocated to deliverables: ${usd(total)} · ${difference<BigInt(0)?'Overallocated':'Unallocated'}: ${usd(difference<BigInt(0)?-difference:difference)}`;}}catch{/* Validation is presented on submit. */}
 async function save(event:React.FormEvent){
  event.preventDefault();setError('');
  try{
   const data:AuctionCampaignInput={name,auction_number:Number(number),closesAt:close.slice(0,10)+'T'+time,featuredCard,auctionPlatform:platform,auctionUrl,lotUrls:splitLinks(lots),owner,assignees,assetLinks:splitLinks(assets),internalNotes:notes,campaignBudgetCents:parseUsd(budget)};
   const parsed=record?auctionCampaignCommand.safeParse({action:'save-auction-campaign',id,version:record.data.version,data}):createAuctionCampaignCommand.safeParse({action:'create-auction-campaign',id,projectId,data,plannedBudgets:{'48':parseUsd(allocations['48']),'24':parseUsd(allocations['24']),'2':parseUsd(allocations['2'])}});
   if(!parsed.success){setError(parsed.error.issues[0].message);return;}
   if(await act(parsed.data))onClose();else setError('Your entries are still here. Check the message above and try again.');
  }catch(e){setError((e as Error).message);}
 }
 return <form className="hq-form hq-auction-settings" aria-label={record?'Edit auction campaign':'Add Auction Campaign'} onSubmit={save}>
  <h3>{record?'Edit auction campaign':'Add Auction Campaign'}</h3>
  <fieldset className="campaign-fields" disabled={busy}>
   <div className="two-fields"><label className="field"><span>Auction number</span><Input required type="number" min="1" max="999999999" step="1" value={number} onChange={e=>setNumber(e.target.value)}/>{!record&&<small>Suggested: #{suggestedNumber}. You can change this before saving.</small>}</label><label className="field"><span>Campaign / batch name</span><Input ref={nameRef} required maxLength={240} value={name} onChange={e=>setName(e.target.value)}/></label></div>
   <label className="field"><span>Featured card / card description</span><Textarea rows={3} maxLength={4000} value={featuredCard} onChange={e=>setFeaturedCard(e.target.value)}/></label>
   <div className="two-fields"><label className="field"><span>Auction platform</span><Input maxLength={300} placeholder="e.g. Fanatics Collect" value={platform} onChange={e=>setPlatform(e.target.value)}/></label><label className="field"><span>Auction URL</span><Input type="url" maxLength={2000} placeholder="https://…" value={auctionUrl} onChange={e=>setAuctionUrl(e.target.value)}/></label></div>
   <label className="field"><span>Featured lot URLs · one per line</span><Textarea rows={3} value={lots} onChange={e=>setLots(e.target.value)}/></label>
   <div className="two-fields"><label className="field"><span>Auction closing date (America/Chicago)</span><Input required type="date" value={close.slice(0,10)} onChange={e=>setClose(e.target.value)}/></label><label className="field"><span>Auction closing time (America/Chicago)</span><Input required type="time" value={time} onChange={e=>setTime(e.target.value)}/></label></div>
   <p className="hq-meta">The 48-, 24-, and 2-hour reminders are calculated from this Sunday closing time.</p>
   <label className="field"><span>Primary owner</span><select required value={owner} onChange={e=>{setOwner(e.target.value);setAssignees(assignees.filter(id=>id!==e.target.value));}}><option value="">Choose an owner</option>{!context.staff.some(s=>s.id===owner)&&owner&&<option value={owner}>{owner} (inactive)</option>}{context.staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <StaffPicker label="Additional assignees" staff={context.staff.filter(s=>s.id!==owner)} value={assignees} onChange={setAssignees}/>
   <label className="field"><span>Asset links · one per line</span><Textarea rows={3} value={assets} onChange={e=>setAssets(e.target.value)}/></label>
   <label className="field"><span>Internal notes</span><Textarea rows={3} maxLength={12000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   <label className="field"><span>Campaign Budget (USD, optional)</span><Input inputMode="decimal" maxLength={13} placeholder="450.00" value={budget} onChange={e=>setBudget(e.target.value)}/></label>
   {!record&&<fieldset className="campaign-fields"><legend>Planned reminder budgets · optional</legend><div className="hq-auction-allocation-inputs">{hours.map(h=><label key={h} className="field"><span>{h} Hour Reminder (USD)</span><Input inputMode="decimal" maxLength={13} value={allocations[h]} onChange={e=>setAllocations({...allocations,[h]:e.target.value})}/></label>)}</div>{balance&&<p className="hq-meta" role="status">{balance}</p>}<p className="hq-meta">You can leave money unallocated or adjust the plan later. Actual spend starts blank.</p></fieldset>}
   <p className="hq-meta">{record?'Campaign membership grants access to the reminders. Existing reminder owners, assignees, notes and budgets remain independently editable. Changing the close recalculates reminder dates; cancel confirmed schedules first.':'Creates three reminders in Collect Weekly Auctions with these starting details. Each reminder can be edited separately.'}</p>
   {error&&<p role="alert" className="notice error">{error}</p>}
   <div className="button-row"><Button type="submit">{busy?'Saving…':record?'Save auction details':'Create auction & 3 reminders'}</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
  </fieldset>
 </form>;
}
