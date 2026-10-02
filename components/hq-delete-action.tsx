'use client';
import {useRef,useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {canDeleteRecord,type DeletableRecord} from '@/lib/hq-deletion';
import type {HqContext} from '@/lib/hq-model';

export function HqDeleteAction({kind,record,context,attachedCount=0,busy,onDelete,onReload}:{kind:'project'|'deliverable';record:DeletableRecord;context:HqContext;attachedCount?:number;busy:boolean;onDelete:(kind:'project'|'deliverable',record:DeletableRecord)=>Promise<void>;onReload:()=>void}){
 const [target,setTarget]=useState<{record:DeletableRecord;count:number}|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 if(!canDeleteRecord(record.data,context))return null;
 const blocked=kind==='project'&&(target?.count??attachedCount)>0;
 async function remove(){
  if(!target||blocked||lock.current)return;
  lock.current=true;setPending(true);setError('');
  try{await onDelete(kind,target.record);setTarget(null);}
  catch(e){setError((e as Error).message||'Deletion failed. Check your connection and try again.');}
  finally{lock.current=false;setPending(false);}
 }
 return <AlertDialog open={!!target} onOpenChange={open=>{if(pending)return;setError('');setTarget(open?{record,count:attachedCount}:null);}}>
  <AlertDialogTrigger asChild><Button variant="outline" disabled={busy}>Delete {kind}</Button></AlertDialogTrigger>
  <AlertDialogContent onEscapeKeyDown={event=>{if(pending)event.preventDefault();}}>
   <AlertDialogHeader><AlertDialogTitle>Delete {kind} “{target?.record.data.title}”?</AlertDialogTitle>
    <AlertDialogDescription>{kind==='project'?`${target?.count??attachedCount} attached deliverable${(target?.count??attachedCount)===1?'':'s'}. `:''}{blocked?'Delete each deliverable individually or move it to another project before deleting this project.':'This removes the item from active work, calendars, schedules and assignments. Its files, comments, spending and audit history are retained.'}</AlertDialogDescription>
   </AlertDialogHeader>
   {blocked&&<Link href={'/projects/'+encodeURIComponent(record.id)+'?tab=deliverables'} onClick={()=>setTarget(null)}>Review attached deliverables →</Link>}
   {kind==='deliverable'&&'publications' in record.data&&Object.values(record.data.publications).some(p=>p.status==='scheduled')&&<p>Deleting from HQ does not cancel posts scheduled on external platforms. Cancel those on the platform if needed.</p>}
   {error&&<div role="alert"><p>{error}</p><p>Try again, or reload the saved records and review the item before confirming again.</p><Button variant="outline" disabled={pending} onClick={()=>{setTarget(null);onReload();}}>Reload saved records</Button></div>}
   <AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy||pending||blocked} onClick={event=>{event.preventDefault();void remove();}}>{pending?'Deleting…':'Delete '+kind}</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
