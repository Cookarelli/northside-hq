'use client';
import {createContext,useContext,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {AssetData} from '@/lib/asset-upload';
import {canReviewMedia,mediaStatus} from '@/lib/media-review';
import {canWork,recordedTime,type Deliverable,type HqRecord,type Project} from '@/lib/hq-model';
import {json,notifyWorkspaceChanged,type Workspace} from '@/lib/hq-client';
import {assetDeliverableHref,assetProjectHref,type SavedAsset} from '@/lib/hq-assets';
const MediaContext=createContext<{workspace:Workspace;onSaved:(asset:SavedAsset)=>void}|null>(null);
export function MediaWorkspace({workspace,onSaved,children}:{workspace:Workspace;onSaved:(asset:SavedAsset)=>void;children:ReactNode}){return <MediaContext.Provider value={{workspace,onSaved}}>{children}</MediaContext.Provider>;}
export function MediaStatus({data}:{data:Partial<AssetData>}){const label=mediaStatus(data);return label?<span className="jon-state">{label}</span>:null;}

export function MediaWorkflow({asset}:{asset:{id:string;data:Partial<AssetData>}}){
 const value=useContext(MediaContext),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[destination,setDestination]=useState(''),lock=useRef(false);
 if(!value)return <MediaStatus data={asset.data}/>;
 const {workspace,onSaved}=value;
 // A refresh updates every appearance of the same underlying file, including open dialogs.
 const data=(workspace.records.find(r=>r.kind==='asset'&&r.id===asset.id)?.data||asset.data) as Partial<AssetData>;
 const deliverables=workspace.records.filter(r=>r.kind==='deliverable') as HqRecord<Deliverable>[],projects=workspace.records.filter(r=>r.kind==='project') as HqRecord<Project>[];
 const d=deliverables.find(r=>r.id===(data.assignedDeliverableId||data.mediaReview?.waiting?.deliverableId||data.mediaReview?.completed?.deliverableId))||(!data.assignedProjectId?deliverables.find(r=>!r.data.deletedAt&&r.data.assets.includes(asset.id)):undefined),p=projects.find(r=>r.id===(data.assignedProjectId||d?.data.projectId))||projects.find(r=>r.data.assets.includes(asset.id)),review=data.mediaReview,status=review?.status||'in_review';
 const candidates=deliverables.filter(r=>!r.data.deletedAt&&r.data.publishing&&(!data.assignedProjectId||r.data.projectId===data.assignedProjectId)&&(!data.assignedDeliverableId||r.id===data.assignedDeliverableId)&&(r.id===data.assignedDeliverableId||(r.data.assets.includes(asset.id)&&r.data.assetRoles?.[asset.id]==='final'))&&canWork(r.data,projects.find(p=>p.id===r.data.projectId)?.data,workspace.context));
 const target=candidates.find(r=>r.id===destination)?.id||(candidates.length===1?candidates[0].id:'');
 const reviewer=workspace.context.staff.find(s=>s.id===review?.approval?.by)?.name||review?.approval?.by;
 async function act(action:'approve'|'waiting'){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{const saved=await json<SavedAsset>('/api/assets/'+encodeURIComponent(asset.id)+'/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,version:review?.version||0,deliverableId:target,note})});onSaved(saved);setNote('');notifyWorkspaceChanged();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);lock.current=false;}
 }
 return <div className="hq-media-workflow">
  <MediaStatus data={data}/>
  <div className="hq-media-destination">{p&&<Link href={assetProjectHref(p.id)}>{p.data.title}</Link>}{d&&<Link href={assetDeliverableHref(d.id,d.data)}>{d.data.title}</Link>}{!p&&!d&&<span className="hq-meta">No destination assigned</span>}</div>
  {mediaStatus(data)&&<>
   {status==='in_review'&&canReviewMedia(workspace.context.staffId)&&<><details className="hq-details"><summary>Review note (optional)</summary><Input aria-label="Review note" maxLength={1000} disabled={busy} value={note} onChange={e=>setNote(e.target.value)}/></details><Button type="button" variant="outline" disabled={busy} onClick={()=>void act('approve')}>{busy?'Saving…':'Approve media'}</Button></>}
   {status==='in_review'&&!canReviewMedia(workspace.context.staffId)&&<p className="hq-meta">Awaiting Joey, Steve, Brody or Nick.</p>}
   {status==='approved'&&candidates.length>0&&<>{candidates.length>1&&<label className="field"><span>Publishing deliverable</span><select disabled={busy} value={target} onChange={e=>setDestination(e.target.value)}><option value="">Choose a deliverable</option>{candidates.map(r=><option key={r.id} value={r.id}>{r.data.title}</option>)}</select></label>}<Button type="button" variant="outline" disabled={busy||!target} onClick={()=>void act('waiting')}>{busy?'Saving…':'Mark Waiting'}</Button></>}
   {status==='approved'&&!candidates.length&&<p className="hq-meta">{d?.data.publishing?'Waiting for this deliverable’s publishing staff.':'Assign to publishing work to mark Waiting.'}</p>}
   {status==='waiting'&&review?.waiting&&<Link href={'/projects/work/'+encodeURIComponent(review.waiting.deliverableId)+'?tab=publishing'}>Record publishing →</Link>}
   {status==='completed'&&review?.completed&&<Link href={'/projects/work/'+encodeURIComponent(review.completed.deliverableId)+'?tab=publishing'}>View publication →</Link>}
   {review?.approval&&<details className="hq-details"><summary>Approval details</summary><p className="hq-meta">Approved by {reviewer} · {recordedTime(review.approval.at)}</p>{review.approval.note&&<p>{review.approval.note}</p>}</details>}
  </>}
  {error&&<p role="alert">{error} <Button type="button" variant="ghost" onClick={notifyWorkspaceChanged}>Reload media</Button></p>}
 </div>;
}
