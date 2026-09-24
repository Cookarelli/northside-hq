'use client';
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {assetContentType,assetProblem} from '@/lib/asset-policy';
import {uploadAsset,type UploadTicket} from '@/lib/asset-upload';
import {notifyWorkspaceChanged} from '@/lib/hq-client';

export function DirectMediaUpload({projectId='',deliverableId='',onSaved}:{projectId?:string;deliverableId?:string;onSaved?:()=>void}){
 const [files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');
 const input=useRef<HTMLInputElement>(null),lock=useRef(false),tickets=useRef(new Map<File,UploadTicket>()),complete=useRef(new Set<File>());
 async function upload(batch:File[]){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  let current:File|undefined;
  try{
   for(const [index,file] of batch.entries()){
    current=file;if(complete.current.has(file))continue;
    setProgress(`Uploading ${index+1} of ${batch.length}: ${file.name}`);
    await uploadAsset(file,tickets.current.get(file),t=>tickets.current.set(file,t),{uploadProjectId:projectId,uploadDeliverableId:deliverableId});
    complete.current.add(file);notifyWorkspaceChanged();onSaved?.();
   }
   setFiles([]);tickets.current.clear();complete.current.clear();setProgress(batch.length===1?'File uploaded and attached.':`${batch.length} files uploaded and attached.`);
  }catch(e){setError(`${current?.name}: ${(e as Error).message}`);setProgress('');}
  finally{lock.current=false;setBusy(false);}
 }
 function choose(batch:File[]){
  if(!batch.length)return;
  const invalid=batch.map(f=>assetProblem(f)||(!/^(image|video)\//.test(assetContentType(f))?'Choose photos or videos.':'')).find(Boolean);
  if(invalid){setError(invalid);return;}
  tickets.current.clear();complete.current.clear();setFiles(batch);void upload(batch);
 }
 return <div className="hq-direct-upload">
  <Button type="button" variant="outline" disabled={busy||files.length>0} onClick={()=>input.current?.click()}>Upload photos/videos</Button>
  <input ref={input} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,video/mp4,video/quicktime,video/webm" aria-label="Choose photos/videos" onChange={e=>{choose(Array.from(e.target.files||[]));e.target.value='';}}/>
  {progress&&<p className="hq-meta" role="status">{progress}</p>}
  {error&&<div role="alert"><p>{error}</p>{!!files.length&&<div className="button-row"><Button type="button" variant="outline" disabled={busy} onClick={()=>void upload(files)}>Retry upload</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>{setFiles([]);tickets.current.clear();complete.current.clear();setError('');}}>Dismiss</Button></div>}</div>}
 </div>;
}
