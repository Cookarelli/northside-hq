'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {AuctionCampaign} from '@/components/hq-auction-campaign';
import {AuctionCampaignForm} from '@/components/auction-campaign-form';
import {canManageAuction,nextAuctionNumber,numberedAuctionName,type AuctionCampaignData} from '@/lib/auction-campaigns';
import {projectTabHref} from '@/lib/hq-project-navigation';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import type {Deliverable,HqRecord,Project,HqContext} from '@/lib/hq-model';
import type {Asset} from '@/components/hq-materials';
import type {Action} from '@/components/hq-workspace';

export function AuctionViews({area,current,history,campaigns,records,project,context,assets,act,busy,selected}:{area:'current-auction'|'auction-history'|'budget';current?:HqRecord<AuctionCampaignData>;history:HqRecord<AuctionCampaignData>[];campaigns:HqRecord<AuctionCampaignData>[];records:HqRecord<Deliverable>[];project:HqRecord<Project>;context:HqContext;assets:Asset[];act:Action;busy:boolean;selected:string}){
 const [adding,setAdding]=useState(false);
 const chosen=campaigns.find(c=>c.id===selected)||current||[...campaigns].sort((a,b)=>b.data.auction_number-a.data.auction_number)[0];
 const choices=area==='auction-history'?history:campaigns;
 const visible=area==='current-auction'?current:area==='auction-history'?history.find(c=>c.id===selected):chosen;
 useEffect(()=>{if(area!=='budget')return;let id=window.location.hash.slice(1);try{id=decodeURIComponent(id);}catch{return;}if(id.startsWith('spend-'))document.getElementById(id)?.scrollIntoView({block:'start'});},[area,visible?.id]);
 return <section className="hq-auction-workspace"><div className="section-title"><h2>{area==='current-auction'?'Current Auction':area==='auction-history'?'Auction History':'Budget & Reconciliation'}</h2>{area==='current-auction'&&canManageAuction(project.data,context)&&!['archived','completed'].includes(project.data.status)&&<Button disabled={busy} onClick={()=>setAdding(!adding)}>{adding?'Cancel new auction':'Add Auction'}</Button>}</div>
 {area==='current-auction'&&adding&&<AuctionCampaignForm projectId={project.id} suggestedNumber={nextAuctionNumber(campaigns)} context={context} act={act} busy={busy} onClose={()=>setAdding(false)}/>}
 {area!=='current-auction'&&<ul className="hq-auction-index" aria-label="Auctions">{[...choices].sort((a,b)=>b.data.auction_number-a.data.auction_number).map(c=><li key={c.id}><Link href={projectTabHref(project.id,area,{auction:c.id})} aria-current={visible?.id===c.id?'true':undefined}>{numberedAuctionName(c.data.name,c.data.auction_number)}</Link><span className="hq-meta">{calendarDay(c.data.closesAt)} · {c.data.reconciliation?.at?'Reconciled':'Open'}</span></li>)}</ul>}
 {visible?<AuctionCampaign key={visible.id} mode={area==='budget'?'budget':'summary'} name={visible.data.name} campaign={visible} records={records.filter(r=>!r.data.deletedAt&&r.data.auctionCampaignId===visible.id)} project={project} context={context} assets={assets} act={act} busy={busy}/>:area==='current-auction'?<p>All auctions are reconciled. Add the next auction to begin.</p>:<p>Select an auction to see its details.</p>}
 {area==='current-auction'&&campaigns.some(c=>c.id!==current?.id&&!history.some(h=>h.id===c.id))&&<><h3>Upcoming auctions</h3><ul className="hq-auction-index">{campaigns.filter(c=>c.id!==current?.id&&!history.some(h=>h.id===c.id)).map(c=><li key={c.id}><Link href={projectTabHref(project.id,'deliverables',{auction:c.id})}>{numberedAuctionName(c.data.name,c.data.auction_number)}</Link><span className="hq-meta">{calendarDay(c.data.closesAt)} · {calendarTime(c.data.closesAt)}</span></li>)}</ul></>}
 </section>;
}
