'use client';
import {useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {BudgetRollup,BudgetSummary} from '@/components/deliverable-budget';
import {AuctionCampaignSettings} from '@/components/auction-campaign-settings';
import {auctionLabel,type AuctionCampaignData} from '@/lib/auction-campaigns';
import {AuctionDeliverableEditor} from '@/components/hq-auction-editor';
import {AuctionStatusControl} from '@/components/hq-auction-status';
import {ResourceLinks,type Asset} from '@/components/hq-materials';
import {auctionStatus,auctionStatuses,reminderLabel} from '@/lib/auction-deliverables';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import {canWork,type Deliverable,type HqContext,type HqRecord,type Project} from '@/lib/hq-model';
import {taskPriorities} from '@/lib/project-tasks';
import type {Action} from '@/components/hq-workspace';

export function AuctionCampaign({name,records,project,context,assets,act,busy,campaign,focused}:{campaign?:HqRecord<AuctionCampaignData>;focused?:string;name:string;records:HqRecord<Deliverable>[];project:HqRecord<Project>;context:HqContext;assets:Asset[];act:Action;busy:boolean}) {
 const heading=useId();
 return <section className="hq-auction-campaign" aria-labelledby={heading}>
  <header className="hq-auction-campaign-heading"><p className="hq-meta">{auctionLabel(records[0]?.data.auction_number)} · Campaign / batch</p><h3 id={heading}>{records[0]?.data.auction_number?`#${records[0].data.auction_number} — `:''}{name}</h3><p className="hq-meta">All times America/Chicago</p>{campaign&&<AuctionCampaignSettings record={campaign} project={project.data} context={context} act={act} busy={busy}/>}</header>
  {campaign&&<CampaignFacts campaign={campaign.data} context={context}/>}
  <BudgetRollup records={records} label={auctionLabel(records[0]?.data.auction_number)} campaignBudget={campaign?.data.campaignBudgetCents}/>
  <ul className="hq-auction-list">{records.map(record=><AuctionReminder key={record.id+':'+(focused===record.id)} focused={focused===record.id} record={record} project={project.data} context={context} assets={assets} act={act} busy={busy}/>)}</ul>
 </section>;
}
function AuctionReminder({record,project,context,assets,act,busy,focused}:{focused:boolean;record:HqRecord<Deliverable>;project:Project;context:HqContext;assets:Asset[];act:Action;busy:boolean}) {
 const d=record.data,[opened,setOpened]=useState(focused),[editing,setEditing]=useState(false),detailsId=useId();
 const rowRef=useRef<HTMLLIElement>(null);
 useEffect(()=>{if(focused)rowRef.current?.scrollIntoView({block:'start'});},[focused]);
 const name=(id:string)=>context.staff.find(s=>s.id===id)?.name||id||'Unassigned';
 const close=d.auctionClosesAt||project.auctionClosesAt,card=d.campaignAuction?.cards.map(c=>c.name).join(', ')||d.campaignFeaturedCard||d.campaignReference;
 const editable=canWork(d,project,context)&&!['completed','archived'].includes(project.status);
 return <li ref={rowRef} id={'deliverable-'+record.id} className="hq-auction-reminder">
  <div className="hq-auction-row-heading"><div><h4>{reminderLabel(d)}</h4>{d.reminderHours&&<p className="hq-meta">{d.title}</p>}</div><div className="hq-work-tags"><span className="tag">{auctionStatuses[auctionStatus(d,project)]}</span><span className="tag">{taskPriorities[d.priority||'normal']} priority</span></div></div>
  <dl className="hq-auction-facts">
   <div><dt>Due date</dt><dd>{d.productionDue?calendarDay(d.productionDue):'Not set'}</dd></div>
   <div className="hq-auction-due-time"><dt>Due time</dt><dd>{d.productionDue?calendarTime(d.productionDue):'Not set'}</dd></div>
   <div><dt>Owner</dt><dd>{name(d.owner)}</dd></div>
   <div><dt>Additional assignees</dt><dd>{d.contributors.filter(id=>id!==d.owner).map(name).join(', ')||'None'}</dd></div>
   <div><dt>Auction closes</dt><dd>{close?<>{calendarDay(close)}<br/><strong>{calendarTime(close)}</strong></>:'Not set'}</dd></div>
   <div><dt>Campaign / card</dt><dd>{d.auction_number&&<>{auctionLabel(d.auction_number)} · </>}{card}</dd></div>
  </dl>
  <BudgetSummary deliverable={d}/>
  {d.blocked&&<p className="notice">Blocked: {d.blockedReason}</p>}
  <div className="hq-auction-row-controls">
   <AuctionStatusControl record={record} project={project} context={context} act={act} busy={busy||editing}/>
   <Button variant="outline" disabled={busy} aria-expanded={opened} aria-controls={detailsId} onClick={()=>{setOpened(!opened);setEditing(!opened&&editable);}}>{opened?'Close deliverable':editable?'Open & edit':'Open deliverable'}</Button>
  </div>
  {opened&&<div id={detailsId} className="hq-auction-detail">
   {editing?<AuctionDeliverableEditor record={record} project={project} context={context} assets={assets} busy={busy} act={act} onClose={()=>setEditing(false)}/>:<>
    <p className="hq-preserve-text">{d.instructions||'No description yet.'}</p>
    {d.destinationUrl&&<p><a href={d.destinationUrl} target="_blank" rel="noreferrer">Open auction / lot</a></p>}
    <ResourceLinks {...d} available={assets}/><h5>Internal notes</h5><p className="hq-preserve-text">{d.notes||'No internal notes yet.'}</p>
    {editable&&<Button variant="outline" disabled={busy} onClick={()=>setEditing(true)}>Edit deliverable</Button>}
   </>}
   <p><Link href={'/projects/work/'+encodeURIComponent(record.id)}>Open full deliverable and history →</Link></p>
  </div>}
 </li>;
}

function CampaignFacts({campaign:c,context}:{campaign:AuctionCampaignData;context:HqContext}){
 const name=(id:string)=>context.staff.find(s=>s.id===id)?.name||id;
 const links=[...new Set([c.auctionUrl,...(c.lotUrls||[])].filter((url):url is string=>!!url))];
 return <details className="hq-details hq-auction-shared"><summary>Campaign details, staff and links</summary>{c.featuredCard&&<p className="hq-preserve-text">{c.featuredCard}</p>}{c.auctionPlatform&&<p>Platform: {c.auctionPlatform}</p>}{c.owner&&<p>Campaign owner: {name(c.owner)}</p>}<p>Additional assignees: {c.assignees?.map(name).join(', ')||'None'}</p>{!!links.length&&<><h4>Auction and featured lots</h4><ul>{links.map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></>}{!!c.assetLinks?.length&&<><h4>Asset links</h4><ul>{c.assetLinks.map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></>}{c.internalNotes&&<><h4>Internal notes</h4><p className="hq-preserve-text">{c.internalNotes}</p></>}</details>;
}
