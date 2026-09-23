import Link from 'next/link';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import {recordedTime,type Deliverable} from '@/lib/hq-model';

const time=(value:string)=>calendarDay(value)+' · '+calendarTime(value);

export function HqCampaignContext({deliverable:d}:{deliverable:Deliverable}) {
 if(!d.campaignReference)return null;
 const links=[...new Set([d.destinationUrl,d.campaignAuction?.batchUrl,...(d.campaignAuction?.cards.map(card=>card.url)||[])].filter((url):url is string=>!!url&&/^https:\/\//.test(url)))];
 return <section className="panel">
  <h2>Campaign / batch</h2>{d.auction_number&&<p><strong>Auction #{d.auction_number}</strong></p>}<p><strong>{d.campaignReference}</strong></p>
  {d.campaignBrief&&<p className="hq-preserve-text">{d.campaignBrief}</p>}
  <p>Due: {d.productionDue?time(d.productionDue):'Not set'}</p>
  <p>Target publish time: {d.publishAt?time(d.publishAt):'Not set'}</p>
  {d.auctionClosesAt&&<p>Auction closes: {time(d.auctionClosesAt)}</p>}
  <p className="hq-meta">All times America/Chicago. Weekly auctions close Sunday between 9:00 PM and 10:00 PM.</p>
  <h3>Auction / lot links</h3>
  {links.length?<ul>{links.map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>:<p>No auction or lot link has been added. Add the link in Edit deliverable.</p>}
  {d.sourceProjectId&&<p><Link href={'/projects/'+encodeURIComponent(d.sourceProjectId)}>Original campaign notes and history</Link></p>}
 </section>;
}

export function DeliverableTimestamps({deliverable:d}:{deliverable:Deliverable}) {
 return <p className="hq-meta">Created: {recordedTime(d.createdAt)} · Updated: {recordedTime(d.updatedAt)} · America/Chicago</p>;
}
