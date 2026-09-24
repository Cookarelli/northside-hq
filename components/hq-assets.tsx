'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {Film,ImageIcon} from 'lucide-react';
import {HqSubnavigation,useHqTab} from '@/components/hq-subnavigation';
import {assetTabs} from '@/lib/hq-tabs';
import {jonAssetIds} from '@/lib/hq-assets';
import {loadWorkspace,notifyWorkspaceChanged,type Workspace} from '@/lib/hq-client';
import {uploadAsset,type AssetData,type UploadTicket} from '@/lib/asset-upload';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {recordedTime,type HqRecord} from '@/lib/hq-model';

type SavedAsset=HqRecord<AssetData & {createdAt?:string;uploadedBy?:string}>;
export function HqAssets(){
 const tab=useHqTab(assetTabs,'all-assets');
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[search,setSearch]=useState(''),[files,setFiles]=useState<File[]>([]),[failedPreviews,setFailedPreviews]=useState<string[]>([]);
 const tickets=useRef(new Map<File,UploadTicket>()),completed=useRef(new Set<File>()),lock=useRef(false),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{const refresh=()=>setRetry(n=>n+1);window.addEventListener('hq-records-changed',refresh);window.addEventListener('focus',refresh);return()=>{window.removeEventListener('hq-records-changed',refresh);window.removeEventListener('focus',refresh);};},[]);
 useEffect(()=>{const controller=new AbortController();loadWorkspace(controller.signal).then(data=>{setWorkspace(data);setLoadError('');}).catch(e=>{if(!controller.signal.aborted)setLoadError(e.message);});return()=>controller.abort();},[retry]);
 const jon=jonAssetIds(workspace?.records||[]),all=(workspace?.records.filter(r=>r.kind==='asset')||[]) as SavedAsset[];
 const assets=all.filter(a=>(tab==='all-assets'||jon.has(a.id))&&a.data.name.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(b.data.createdAt||'').localeCompare(a.data.createdAt||''));
 async function upload(){
  if(!files.length||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
  let uploading:File|undefined;
  try{for(const file of files){uploading=file;if(completed.current.has(file))continue;await uploadAsset(file,tickets.current.get(file),t=>tickets.current.set(file,t));completed.current.add(file);}
   setNotice(files.length===1?'Asset uploaded. Attach it to a project or deliverable from its editor.':`${files.length} assets uploaded. Attach them to the relevant work.`);setFiles([]);tickets.current.clear();completed.current.clear();if(input.current)input.current.value='';
  }catch(e){setError(`${uploading?.name}: ${(e as Error).message} Retry this batch to continue; completed files will not be uploaded again.`);}
  finally{notifyWorkspaceChanged();lock.current=false;setBusy(false);}

 }
 function backup(){if(!workspace)return;const url=URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),records:workspace.records},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='northside-workspace-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <div className="hq-content"><HqSubnavigation tabs={assetTabs} active={tab} label="Asset areas"/>
 <div className="section-title"><div><h2>{tab==='jons-content'?"Jon’s Content":'All Assets'}</h2><p className="hq-meta">{tab==='jons-content'?"Files uploaded by Jon or attached to work assigned to Jon.":'Shared photos and videos for Northside projects and deliverables.'}</p></div><Link href="/assets/research">Research &amp; sources →</Link></div>
 {(error||loadError)&&<div role="alert" className="notice error">{error||loadError} <Button variant="outline" onClick={()=>setRetry(n=>n+1)}>Reload assets</Button></div>}{notice&&<p role="status">{notice}</p>}
 {!workspace&&!loadError&&<p role="status">Loading assets…</p>}
 {workspace&&<><div className="hq-asset-actions"><label className="field"><span>Find an asset</span><Input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search file names"/></label><details className="hq-details"><summary>Upload asset</summary><form className="hq-form" onSubmit={e=>{e.preventDefault();void upload();}}><p className="hq-meta">Photos or short videos, up to 40 MB. Keep full resolution originals with your photographer.</p><input ref={input} type="file" multiple required disabled={busy} accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" aria-label="Choose photo or video" onChange={e=>{setFiles(Array.from(e.target.files||[]));tickets.current.clear();completed.current.clear();setError('');}}/><Button type="submit" disabled={busy||!files.length}>{busy?'Uploading…':files.length>1?'Upload '+files.length+' files':'Upload file'}</Button></form></details></div>
 <p className="hq-meta">{assets.length} {assets.length===1?'asset':'assets'}</p>
 <div className="hq-asset-library">{assets.map(asset=><article className="panel" key={asset.id}><div className="hq-asset-preview" aria-hidden="true">{asset.data.type?.startsWith('video/')?<Film size={38}/>:failedPreviews.includes(asset.id)?<ImageIcon size={38}/>:<Image src={'/api/assets/'+encodeURIComponent(asset.id)} alt="" width={400} height={200} unoptimized onError={()=>setFailedPreviews(old=>old.includes(asset.id)?old:[...old,asset.id])}/>}</div><h3>{asset.data.name}</h3><p className="hq-meta">{asset.data.type?.startsWith('video/')?'Video':'Image'} · {(asset.data.size/1024/1024).toFixed(1)} MB{asset.data.uploadedBy?' · '+(workspace.context.staff.find(s=>s.id===asset.data.uploadedBy)?.name||asset.data.uploadedBy):''}</p>{asset.data.createdAt&&<p className="hq-meta">Uploaded {recordedTime(asset.data.createdAt)}</p>}<a className="hq-asset-open" href={'/api/assets/'+encodeURIComponent(asset.id)} target="_blank" rel="noreferrer">Open asset ↗</a></article>)}</div>
 {!assets.length&&<div className="panel hq-empty"><h3>{search?'No matching assets':tab==='jons-content'?"No files linked to Jon yet":'No assets uploaded yet'}</h3><p>{search?'Try another file name.':tab==='jons-content'?"Jon’s uploads and files attached to his assigned work will appear here. All other files remain in All Assets.":'Upload a photo or video, then attach it to the relevant work.'}</p></div>}
 <details className="hq-details"><summary>Workspace export</summary><p className="hq-meta">Download saved records, including preserved historical records. Uploaded file bytes are not included.</p><Button variant="outline" onClick={backup}>Export saved workspace records</Button></details></>}
 </div>;
}
