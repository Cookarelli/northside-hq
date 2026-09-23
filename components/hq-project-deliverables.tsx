'use client';
import {useHqClock} from '@/components/use-hq-clock';
import {useState} from 'react';
import {finished} from '@/lib/hq-operations';
import {canManageTask,urgencySort} from '@/lib/project-tasks';
import type {Deliverable,HqRecord,HqContext,Project} from '@/lib/hq-model';
import {Button} from '@/components/ui/button';
import {AuctionCampaignForm} from '@/components/auction-campaign-form';
import {canManageAuction,isWeeklyAuctionHome,nextAuctionNumber,type AuctionCampaignData} from '@/lib/auction-campaigns';
import {campaignGroups} from '@/lib/auction-deliverables';
import {AuctionCampaign} from '@/components/hq-auction-campaign';
import type {Asset} from '@/components/hq-materials';
import {HqWorkItem} from '@/components/hq-work-item';
import {ProjectTaskForm} from '@/components/project-task';
import type {Action} from '@/components/hq-workspace';
export function HqProjectDeliverables({records,project,context,act,busy,assets=[],campaigns=[],focused=''}:{records:HqRecord<Deliverable>[];project:HqRecord<Project>;context:HqContext;act:Action;busy:boolean;assets?:Asset[];campaigns?:HqRecord<AuctionCampaignData>[];focused?:string}){
 const now=useHqClock();
 const [adding,setAdding]=useState(false),[editing,setEditing]=useState(''),visible=records.filter(r=>!r.data.deletedAt),groups=campaignGroups(visible),groupedIds=new Set(groups.flatMap(g=>g.records.map(r=>r.id))),other=visible.filter(r=>!groupedIds.has(r.id)),open=other.filter(r=>!finished(r.data)).sort(urgencySort),complete=other.filter(r=>finished(r.data));
 const row=(r:HqRecord<Deliverable>)=><HqWorkItem key={r.id} record={r} now={now} project={project} context={context} act={act} busy={busy} statusControl onEdit={r.data.workflow==='task'&&canManageTask(r.data,project.data,context)&&!['completed','archived'].includes(project.data.status)?()=>setEditing(r.id):undefined}/>;
 const record=visible.find(r=>r.id===editing);
 return <>{isWeeklyAuctionHome(project,campaigns)&&canManageAuction(project.data,context)&&!['archived','completed'].includes(project.data.status)&&(adding?<AuctionCampaignForm projectId={project.id} suggestedNumber={nextAuctionNumber(campaigns)} context={context} act={act} busy={busy} onClose={()=>setAdding(false)}/>:<Button className="hq-add-auction" disabled={busy} onClick={()=>setAdding(true)}>Add Auction Campaign</Button>)}{groups.map(group=><AuctionCampaign key={group.key} campaign={campaigns.find(c=>c.id===group.key)} focused={focused} name={group.name} records={group.records} project={project} context={context} assets={assets} act={act} busy={busy}/>)}{record&&<ProjectTaskForm key={record.id+':'+record.data.version} project={project} record={record} context={context} busy={busy} onSave={act} onCancel={()=>setEditing('')}/>}{(!groups.length||other.length>0)&&<h3>{groups.length?'Other auction work':'Open deliverables'} <span className="hq-count">{open.length}</span></h3>}{open.length?<ul className="hq-work-list">{open.map(row)}</ul>:!groups.length?<p className="hq-meta">No open deliverables. Add one above to schedule the next step.</p>:null}{!!complete.length&&<details className="hq-details"><summary>Completed ({complete.length})</summary><ul className="hq-work-list">{complete.map(row)}</ul></details>}</>;
}
