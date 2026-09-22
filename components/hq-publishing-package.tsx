'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {approvalCurrent,type Deliverable,type Project} from '@/lib/hq-model';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import {ResourceLinks,type Asset} from '@/components/hq-materials';
export function PublishingPackagePanel({deliverable:d,project,assets,name}:{deliverable:Deliverable;project?:Project;assets:Asset[];name:(id:string)=>string}) {
 const [message,setMessage]=useState('');
 const pack=d.approval?.package;
 if(!pack||!approvalCurrent(d,project)||d.status!=='ready')return <p className="notice">Submit the current version and obtain owner approval to prepare the publishing package.</p>;
 return <div className="hq-package"><p>Approved content version {d.approval?.contentVersion} · publisher: {name(pack.publisher)}</p><p>Destinations: {pack.platforms.join(', ')} · planned for {calendarDay(pack.publishAt)} at {calendarTime(pack.publishAt)} America/Chicago</p><p>{pack.promotionMode==='paid'?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(pack.promotionCents/100)+' approved for '+pack.promotionChannel:'Organic · no promotion budget required'}</p>
 <ResourceLinks assets={pack.finalAssets} references={pack.finalLinks} assetRoles={Object.fromEntries(pack.finalAssets.map(id=>[id,'final']))} linkRoles={Object.fromEntries(pack.finalLinks.map(url=>[url,'final']))} available={assets}/>
 {pack.caption&&<><h3>Approved caption</h3><p className="hq-preserve-text">{pack.caption}</p><Button type="button" variant="outline" onClick={async()=>{try{await navigator.clipboard.writeText(pack.caption);setMessage('Approved caption copied.');}catch{setMessage('Copy was unavailable. Select and copy the approved caption above.');}}}>Copy approved caption</Button></>}
 {pack.destinationUrl&&<p><a href={pack.destinationUrl} target="_blank" rel="noreferrer">Open approved destination link →</a></p>}{message&&<p role="status">{message}</p>}
 </div>;
}
