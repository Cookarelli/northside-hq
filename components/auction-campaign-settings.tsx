'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {auctionCampaignCommand,type AuctionCampaignData} from '@/lib/auction-campaigns';
import {scheduleWall} from '@/lib/consignment';
import type {HqContext,HqRecord,Project} from '@/lib/hq-model';
import type {Action} from '@/components/hq-workspace';

export function AuctionCampaignSettings({record,project,context,act,busy}:{record:HqRecord<AuctionCampaignData>;project:Project;context:HqContext;act:Action;busy:boolean}){
 const [editing,setEditing]=useState(false);
 if(['completed','archived'].includes(project.status)||!(context.admin||project.owner===context.staffId||project.members.includes(context.staffId)))return null;
 return editing?<CampaignEditor key={record.data.version} record={record} act={act} busy={busy} onClose={()=>setEditing(false)}/>:<Button variant="outline" onClick={()=>setEditing(true)}>Edit auction details</Button>;
}
function CampaignEditor({record,act,busy,onClose}:{record:HqRecord<AuctionCampaignData>;act:Action;busy:boolean;onClose:()=>void}){
 const [name,setName]=useState(record.data.name),[number,setNumber]=useState(String(record.data.auction_number)),[close,setClose]=useState(scheduleWall(record.data.closesAt)),[error,setError]=useState('');
 return <form className="hq-form hq-auction-settings" onSubmit={async e=>{e.preventDefault();const parsed=auctionCampaignCommand.safeParse({action:'save-auction-campaign',id:record.id,version:record.data.version,data:{name,auction_number:Number(number),closesAt:close}});if(!parsed.success){setError(parsed.error.issues[0].message);return;}setError('');if(await act(parsed.data))onClose();}}><fieldset className="campaign-fields" disabled={busy}><div className="two-fields"><label className="field"><span>Auction number</span><Input required type="number" min="1" max="999999999" step="1" value={number} onChange={e=>setNumber(e.target.value)}/></label><label className="field"><span>Campaign name</span><Input required maxLength={300} value={name} onChange={e=>setName(e.target.value)}/></label></div><label className="field"><span>Auction closes (America/Chicago)</span><Input required type="datetime-local" value={close} onChange={e=>setClose(e.target.value)}/></label><p className="hq-meta">Changing the close recalculates the 48-, 24-, and 2-hour reminders. Cancel confirmed schedules first; published reminder schedules remain in history.</p>{error&&<p role="alert">{error}</p>}<div className="button-row"><Button type="submit">Save auction details</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div></fieldset></form>;
}
