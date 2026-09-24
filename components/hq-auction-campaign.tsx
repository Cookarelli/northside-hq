'use client';
import {DirectMediaUpload} from '@/components/direct-media-upload';
import {numberedAuctionName} from '@/lib/auction-campaigns';
import {useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {AuctionSpending} from '@/components/auction-spending';
import {campaignFinancials,compactUsd,compactVariance} from '@/lib/auction-finance';
import {DeliverableBudget} from '@/components/deliverable-budget';
import {projectTabHref} from '@/lib/hq-project-navigation';
import {AuctionCampaignSettings} from '@/components/auction-campaign-settings';
import {canManageAuction,type AuctionCampaignData} from '@/lib/auction-campaigns';
import {AuctionDeliverableEditor} from '@/components/hq-auction-editor';
import {AuctionStatusControl} from '@/components/hq-auction-status';
import {ResourceLinks,AssignedContent,type Asset} from '@/components/hq-materials';
import {reminderLabel} from '@/lib/auction-deliverables';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import {canWork,type Deliverable,type HqContext,type HqRecord,type Project} from '@/lib/hq-model';
import {taskPriorities} from '@/lib/project-tasks';
import type {Action} from '@/components/hq-workspace';

export function AuctionCampaign({name,records,project,context,assets,act,busy,campaign,focused,mode='deliverables'}:{mode?:'deliverables'|'budget'|'summary';campaign?:HqRecord<AuctionCampaignData>;focused?:string;name:string;records:HqRecord<Deliverable>[];project:HqRecord<Project>;context:HqContext;assets:Asset[];act:Action;busy:boolean}) {
 const heading=useId(),totals=campaignFinancials(campaign?.data,records),reconciled=totals.state==='Reconciled',close=campaign?.data.closesAt||records[0]?.data.auctionClosesAt||project.data.auctionClosesAt;
 return <section className={'hq-auction-campaign'+(reconciled?' is-reconciled':'')} aria-labelledby={heading}>
  <header className="hq-auction-campaign-heading"><div className="hq-auction-title-line"><h3 id={heading}>{numberedAuctionName(name,campaign?.data.auction_number||records[0]?.data.auction_number)}</h3>{reconciled&&<span className="hq-reconciled">RECONCILED</span>}</div>
   <p className="hq-auction-close"><strong>Closes:</strong> {close?<>{calendarDay(close)} · {calendarTime(close)}</>:'Not set'} <span className="hq-meta">America/Chicago</span></p>
   {mode==='budget'&&<><dl className="hq-auction-overview"><div><dt>Budget{campaign?.data.campaignBudgetCents==null?' · deliverable total':''}</dt><dd>{totals.budget===null?'Not set':compactUsd(totals.budget)}</dd></div><div><dt>Actual</dt><dd>{totals.pending===totals.count?'Not recorded':compactUsd(totals.actual)}</dd></div><div><dt>Variance</dt><dd>{compactVariance(totals.variance)}</dd></div><div><dt>Reconciliation</dt><dd>{totals.state}</dd></div></dl>
   {totals.unallocated!==null&&totals.unallocated!==BigInt(0)&&<p className="hq-meta">Allocated {compactUsd(totals.planned)} · {compactUsd(totals.unallocated<BigInt(0)?-totals.unallocated:totals.unallocated)} {totals.unallocated<BigInt(0)?'overallocated':'unallocated'}</p>}
   {!totals.ready&&<p className="hq-meta">{totals.published} of {totals.count} reminders published · {totals.pending} awaiting actual spend or no-spend confirmation.</p>}
   </>}{campaign&&mode!=='deliverables'&&<div className="hq-auction-actions">{mode==='budget'&&totals.ready&&!reconciled&&canManageAuction(project.data,context,campaign.data)&&<Button disabled={busy} onClick={()=>void act({action:'auction-reconcile',id:campaign.id,version:campaign.data.version,deliverableVersions:Object.fromEntries(records.map(r=>[r.id,r.data.version]))})}>Reconcile Auction</Button>}<AuctionCampaignSettings record={campaign} project={project.data} context={context} act={act} busy={busy}/></div>}
   {mode==='budget'&&reconciled&&<p className="hq-meta">Reconciled by {context.staff.find(s=>s.id===campaign?.data.reconciliation?.by)?.name||campaign?.data.reconciliation?.by}. Changes to budgets, spend or publication reopen reconciliation.</p>}
  </header>
  {campaign&&mode!=='deliverables'&&<CampaignFacts campaign={campaign.data} context={context}/>}

  {mode==='deliverables'&&<><p><Link href={projectTabHref(project.id,'budget',{auction:campaign?.id})}>Budget &amp; reconciliation →</Link></p><ul className="hq-auction-list">{records.map(record=><AuctionReminder key={record.id+':'+(focused===record.id)} focused={focused===record.id} record={record} project={project.data} context={context} assets={assets} act={act} busy={busy}/>)}</ul></>}
  {mode==='budget'&&[...records].sort((a,b)=>(b.data.reminderHours||0)-(a.data.reminderHours||0)).map(record=><article key={record.id} id={'spend-'+record.id} className="hq-auction-detail"><h4>{reminderLabel(record.data)}</h4><DeliverableBudget compact key={record.id+':'+record.data.version} record={record} project={project.data} context={context} busy={busy} act={act}/><AuctionSpending record={record} project={project.data} context={context} act={act} busy={busy}/><Link href={projectTabHref(project.id,'deliverables',{deliverable:record.id})}>Open deliverable →</Link></article>)}
  {mode==='summary'&&<div className="button-row"><Link href={projectTabHref(project.id,'deliverables',{auction:campaign?.id})}>Open deliverables →</Link><Link href={projectTabHref(project.id,'budget',{auction:campaign?.id})}>Budget &amp; reconciliation →</Link></div>}
 </section>;
}
function AuctionReminder({record,project,context,assets,act,busy,focused}:{focused:boolean;record:HqRecord<Deliverable>;project:Project;context:HqContext;assets:Asset[];act:Action;busy:boolean}) {
 const d=record.data,[opened,setOpened]=useState(focused),[editing,setEditing]=useState(false),detailsId=useId();
 const rowRef=useRef<HTMLLIElement>(null);
 useEffect(()=>{if(focused){rowRef.current?.scrollIntoView({block:'start'});rowRef.current?.focus({preventScroll:true});}},[focused]);
 const name=(id:string)=>context.staff.find(s=>s.id===id)?.name||id||'Unassigned';
 const card=d.campaignAuction?.cards.map(c=>c.name).join(', ')||d.campaignFeaturedCard||d.campaignReference;
 const editable=canWork(d,project,context)&&!['completed','archived'].includes(project.status);
 return <li ref={rowRef} id={'deliverable-'+record.id} tabIndex={-1} className="hq-auction-reminder">
  <div className="hq-auction-row-heading"><h4>{reminderLabel(d)}</h4><Button variant="outline" disabled={busy} aria-expanded={opened} aria-controls={detailsId} onClick={()=>{setOpened(!opened);setEditing(false);}}>{opened?'Close deliverable':'Open deliverable'}</Button></div>
  <div className="hq-auction-row-main"><AuctionStatusControl compact showHistory={opened} record={record} project={project} context={context} act={act} busy={busy||editing}/><dl className="hq-auction-row-facts"><div><dt>Owner</dt><dd>{name(d.owner)}</dd></div><div><dt>Due · Chicago</dt><dd>{d.productionDue?<>{calendarDay(d.productionDue)} · {calendarTime(d.productionDue)}</>:'Not set'}</dd></div>{d.plannedBudgetCents!=null&&<div><dt>Budget</dt><dd>{compactUsd(d.plannedBudgetCents)}</dd></div>}</dl></div>
  {d.blocked&&<p className="notice">Blocked: {d.blockedReason}</p>}
  {opened&&<div id={detailsId} className="hq-auction-detail">
   <p className="hq-meta">{d.title} · {taskPriorities[d.priority||'normal']} priority</p><p className="hq-meta">Additional assignees: {d.contributors.filter(id=>id!==d.owner).map(name).join(', ')||'None'} · {card}</p>
   {editing?<AuctionDeliverableEditor record={record} project={project} context={context} assets={assets} busy={busy} act={act} onClose={()=>setEditing(false)}/>:<>
    <p className="hq-preserve-text">{d.instructions||'No description yet.'}</p>
    {d.destinationUrl&&<p><a href={d.destinationUrl} target="_blank" rel="noreferrer">Open auction / lot</a></p>}
    <DirectMediaUpload projectId={d.projectId} deliverableId={record.id}/><ResourceLinks {...d} available={assets}/><AssignedContent available={assets} kind="deliverable" id={record.id} attached={d.assets}/><h5>Internal notes</h5><p className="hq-preserve-text">{d.notes||'No internal notes yet.'}</p>
    {editable&&<Button variant="outline" disabled={busy} onClick={()=>setEditing(true)}>Edit deliverable</Button>}
   </>}
   <p><Link href={projectTabHref(d.projectId,'budget',{auction:d.auctionCampaignId})+'#spend-'+encodeURIComponent(record.id)}>Budget and spending →</Link></p>
   <p><Link href={'/projects/work/'+encodeURIComponent(record.id)+'?tab=work'}>Open full deliverable and history →</Link></p>
  </div>}
 </li>;
}

function CampaignFacts({campaign:c,context}:{campaign:AuctionCampaignData;context:HqContext}){
 const name=(id:string)=>context.staff.find(s=>s.id===id)?.name||id;
 const links=[...new Set([c.auctionUrl,...(c.lotUrls||[])].filter((url):url is string=>!!url))];
 return <details className="hq-details hq-auction-shared"><summary>Campaign details, staff and links</summary>{c.featuredCard&&<p className="hq-preserve-text">{c.featuredCard}</p>}{c.auctionPlatform&&<p>Platform: {c.auctionPlatform}</p>}{c.owner&&<p>Campaign owner: {name(c.owner)}</p>}<p>Additional assignees: {c.assignees?.map(name).join(', ')||'None'}</p>{!!links.length&&<><h4>Auction and featured lots</h4><ul>{links.map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></>}{!!c.assetLinks?.length&&<><h4>Asset links</h4><ul>{c.assetLinks.map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></>}{c.internalNotes&&<><h4>Internal notes</h4><p className="hq-preserve-text">{c.internalNotes}</p></>}</details>;
}
