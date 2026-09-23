'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {AuctionCampaignForm} from '@/components/auction-campaign-form';
import {canManageAuction,type AuctionCampaignData} from '@/lib/auction-campaigns';
import type {HqContext,HqRecord,Project} from '@/lib/hq-model';
import type {Action} from '@/components/hq-workspace';
export function AuctionCampaignSettings({record,project,context,act,busy}:{record:HqRecord<AuctionCampaignData>;project:Project;context:HqContext;act:Action;busy:boolean}){
 const [editing,setEditing]=useState(false);
 if(['completed','archived'].includes(project.status)||!canManageAuction(project,context,record.data))return null;
 return editing?<AuctionCampaignForm key={record.data.version} projectId={record.data.projectId} record={record} suggestedNumber={record.data.auction_number} context={context} act={act} busy={busy} onClose={()=>setEditing(false)}/>:<Button variant="outline" onClick={()=>setEditing(true)}>Edit auction details</Button>;
}
