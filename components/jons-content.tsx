'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {ChevronLeft,ChevronRight,FileText,Film,ImageIcon,Upload,X} from 'lucide-react';
import {ContentAssignmentPicker} from '@/components/content-assignment-picker';
import {auctionCalendarTitle} from '@/lib/auction-campaigns';
import {assetDeliverableHref,assetProjectHref} from '@/lib/hq-assets';
import {HqPageActions} from '@/components/hq-page-actions';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {assetAccept,assetProblem} from '@/lib/asset-policy';
import {uploadAsset,type UploadTicket} from '@/lib/asset-upload';
import {assignedAsset,assetTitle,filterAssets,jonAssetIds,newestAssets,type SavedAsset} from '@/lib/hq-assets';
import {json,notifyWorkspaceChanged,type Workspace} from '@/lib/hq-client';
import {recordedTime,type Deliverable,type HqRecord,type Project} from '@/lib/hq-model';

function assetUrl(asset:SavedAsset){return '/api/assets/'+encodeURIComponent(asset.id);}
function uploadedDate(asset:SavedAsset){const date=asset.data.uploadedAt||asset.data.createdAt;return date&&Number.isFinite(Date.parse(date))?recordedTime(date):'Upload date unavailable';}
function AssetPreview({asset,video=false}:{asset:SavedAsset;video?:boolean}){
 const [failed,setFailed]=useState(false),type=asset.data.type||'';
 return <span className="jon-preview" aria-hidden="true">{!failed&&type.startsWith('image/')&&type!=='image/svg+xml'?<Image src={assetUrl(asset)} alt="" width={240} height={128} loading="lazy" unoptimized onError={()=>setFailed(true)}/>:!failed&&video&&type.startsWith('video/')?<video src={assetUrl(asset)+'#t=0.1'} muted playsInline preload="metadata" onError={()=>setFailed(true)}/>:type.startsWith('video/')?<Film/>:type.startsWith('image/')?<ImageIcon/>:<FileText/>}</span>;
}
function AssignmentState({asset}:{asset:SavedAsset}){return <span className={'jon-state '+(assignedAsset(asset)?'is-assigned':'')}>{assignedAsset(asset)?'Assigned':'Unassigned'}</span>;}
function AssignmentDestination({asset,workspace}:{asset:SavedAsset;workspace:Workspace}){
 const d=workspace.records.find(r=>r.kind==='deliverable'&&r.id===asset.data.assignedDeliverableId),p=workspace.records.find(r=>r.kind==='project'&&r.id===asset.data.assignedProjectId);
 return assignedAsset(asset)?<span className="jon-assigned-to"><span className="hq-meta">Assigned to:</span>{p&&<Link href={assetProjectHref(p.id)}>{(p.data as Project).title}</Link>}{d&&<Link href={assetDeliverableHref(d.id,d.data as Deliverable)}>{auctionCalendarTitle(d.data as Deliverable)}</Link>}{!p&&!d&&<span>Assignment unavailable</span>}</span>:null;
}
function AssignmentDialog({asset,workspace,onClose,onSaved}:{asset:SavedAsset;workspace:Workspace;onClose:()=>void;onSaved:(asset:SavedAsset)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false);
 const [projectId,setProjectId]=useState(asset.data.assignedProjectId||''),[deliverableId,setDeliverableId]=useState(asset.data.assignedDeliverableId||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const projects=(workspace.records.filter(r=>r.kind==='project') as HqRecord<Project>[]).filter(r=>!r.data.migratedToProjectId);
 const deliverables=(workspace.records.filter(r=>r.kind==='deliverable') as HqRecord<Deliverable>[]).filter(r=>!r.data.deletedAt&&(!r.data.projectId||projects.some(p=>p.id===r.data.projectId)));
 const choices=deliverables.filter(d=>!projectId||d.data.projectId===projectId);
 useEffect(()=>{dialog.current?.showModal();},[]);
 async function save(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{const saved=await json<SavedAsset>(assetUrl(asset)+'/assignment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:asset.data.assignmentVersion||0,projectId,deliverableId})});onSaved(saved);onClose();}
  catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
 }
 return <dialog className="jon-dialog" ref={dialog} aria-labelledby="jon-assign-title" onCancel={e=>{if(busy)e.preventDefault();else onClose();}} onClose={onClose}>
  <form onSubmit={e=>{e.preventDefault();void save();}} className="hq-form">
   <div className="section-title"><h2 id="jon-assign-title">{assignedAsset(asset)?'Change assignment':'Assign content'}</h2><Button type="button" variant="ghost" aria-label="Close assignment" disabled={busy} onClick={onClose}><X/></Button></div>
   <p className="jon-file-title">{assetTitle(asset)}</p><a href={assetUrl(asset)} target="_blank" rel="noreferrer">Preview ↗</a>
   <ContentAssignmentPicker label="Project" value={projectId} disabled={busy} options={projects.map(p=>({id:p.id,label:p.data.title}))} onChange={id=>{setProjectId(id);setDeliverableId('');}}/>
   <ContentAssignmentPicker key={projectId} label="Deliverable" value={deliverableId} disabled={busy} options={choices.map(d=>({id:d.id,label:auctionCalendarTitle(d.data)+(!projectId&&d.data.projectId?' — '+projects.find(p=>p.id===d.data.projectId)?.data.title:'')}))} onChange={id=>{setDeliverableId(id);if(id)setProjectId(deliverables.find(d=>d.id===id)?.data.projectId||'');}}/>
   {!projects.length&&!deliverables.length&&<p className="hq-meta">No projects or deliverables yet. This file can stay unassigned.</p>}
   {asset.data.note&&<p className="hq-preserve-text">{asset.data.note}</p>}
   <p className="hq-meta">Uploaded by {workspace.context.staff.find(s=>s.id===asset.data.uploadedBy)?.name||asset.data.uploadedBy||'Unknown'} · {uploadedDate(asset)}</p>
   {asset.data.assignedAt&&<p className="hq-meta">Assignment updated by {workspace.context.staff.find(s=>s.id===asset.data.assignedBy)?.name||asset.data.assignedBy} · {recordedTime(asset.data.assignedAt)}</p>}
   {error&&<div role="alert" className="notice error"><p>{error}</p><Button type="button" variant="outline" onClick={()=>{notifyWorkspaceChanged();onClose();}}>Reload content</Button></div>}
   <div className="button-row"><Button type="submit" disabled={busy}>{busy?'Saving…':'Done'}</Button>{assignedAsset(asset)&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{setProjectId('');setDeliverableId('');}}>Clear assignment</Button>}<Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button></div>
  </form>
 </dialog>;
}
export function JonsContent({workspace,onSaved}:{workspace:Workspace;onSaved:(asset:SavedAsset)=>void}){
 const [search,setSearch]=useState(''),[filter,setFilter]=useState<'all'|'unassigned'|'assigned'>('all'),[files,setFiles]=useState<File[]>([]),[note,setNote]=useState(''),[title,setTitle]=useState(''),[busy,setBusy]=useState(false),[started,setStarted]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[progress,setProgress]=useState(''),[selected,setSelected]=useState<SavedAsset|null>(null);
 const input=useRef<HTMLInputElement>(null),slider=useRef<HTMLUListElement>(null),tickets=useRef(new Map<File,UploadTicket>()),completed=useRef(new Set<File>()),lock=useRef(false);
 const ids=jonAssetIds(workspace.records),assets=newestAssets(workspace.records.filter(r=>r.kind==='asset'&&ids.has(r.id)) as SavedAsset[]),history=filterAssets(assets,search,filter);
 function choose(files:File[]){
  const invalid=files.map(file=>({file,problem:assetProblem(file)})).find(item=>item.problem);
  if(invalid){setError(invalid.file.name+': '+invalid.problem);return;}
  setFiles(files);setStarted(false);setNote('');setTitle('');setError('');setNotice('');tickets.current.clear();completed.current.clear();
 }
 async function upload(){
  if(!files.length||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
  let current:File|undefined;
  try{
   for(const [index,file] of files.entries()){
    current=file;if(completed.current.has(file))continue;setProgress(`Uploading ${index+1} of ${files.length}: ${file.name}`);
    const data=await uploadAsset(file,tickets.current.get(file),ticket=>{tickets.current.set(file,ticket);setStarted(true);},{collection:'jons-content',note,title:files.length===1?title:''});
    completed.current.add(file);onSaved({kind:'asset',id:data.id,data});
   }
   setNotice(files.length===1?'Content uploaded. Assign it when you’re ready.':`${files.length} files uploaded. Assign them when you’re ready.`);setFiles([]);tickets.current.clear();completed.current.clear();setNote('');setTitle('');
  }catch(e){setError(`${current?.name}: ${(e as Error).message} Retry to continue; completed files are already saved.`);}
  finally{setProgress('');setBusy(false);lock.current=false;notifyWorkspaceChanged();}
 }
 function scroll(direction:number){slider.current?.scrollBy({left:direction*440,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 return <div className="jon-content">
  <HqPageActions><div className="section-title jon-header"><Button className="jon-upload-button" disabled={busy||files.length>0} onClick={()=>input.current?.click()}><Upload size={20}/>Upload</Button><input ref={input} hidden type="file" multiple accept={assetAccept} onChange={e=>{choose(Array.from(e.target.files||[]));e.target.value='';}}/></div></HqPageActions>
  <p className="hq-meta jon-file-help">Video, images, graphics and documents · up to 40 MB per file</p>
  {files.length>0&&<form className="panel hq-form jon-upload-form" onSubmit={e=>{e.preventDefault();void upload();}}><h3>{files.length===1?files[0].name:files.length+' files selected'}</h3>{files.length>1&&<ul className="jon-selected-files">{files.map((file,index)=><li key={index}>{file.name}</li>)}</ul>}{files.length===1&&<label className="field"><span>Title (optional)</span><Input maxLength={250} value={title} placeholder={files[0].name} disabled={busy||started} onChange={e=>setTitle(e.target.value)}/></label>}<label className="field"><span>Short note (optional)</span><Input maxLength={500} value={note} disabled={busy||started} onChange={e=>setNote(e.target.value)}/></label><p className="hq-meta">Files start unassigned.</p><div className="button-row"><Button type="submit" disabled={busy}>{busy?'Uploading…':started?'Retry upload':files.length===1?'Upload file':'Upload files'}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>{setFiles([]);tickets.current.clear();completed.current.clear();setError('');}}>Cancel</Button></div></form>}
  {progress&&<p role="status">{progress}</p>}{error&&<p role="alert" className="notice error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
  <section aria-labelledby="jon-latest"><div className="section-title"><h3 id="jon-latest">Latest Uploads</h3>{assets.length>1&&<div className="button-row"><Button variant="outline" aria-label="Scroll latest uploads left" onClick={()=>scroll(-1)}><ChevronLeft/></Button><Button variant="outline" aria-label="Scroll latest uploads right" onClick={()=>scroll(1)}><ChevronRight/></Button></div>}</div>
   {assets.length?<ul ref={slider} className="jon-slider" tabIndex={0} aria-label="Latest uploads, scroll horizontally">{assets.slice(0,8).map(asset=><li key={asset.id}><button className="jon-latest-card" onClick={()=>setSelected(asset)} aria-label={`Assign or view ${assetTitle(asset)}`}><AssetPreview asset={asset} video/><span className="jon-latest-body"><strong className="jon-file-title">{assetTitle(asset)}</strong><span className="hq-meta">{uploadedDate(asset)}</span><AssignmentState asset={asset}/></span></button></li>)}</ul>:<div className="jon-empty"><Upload aria-hidden="true"/><p>No uploads yet. Use Upload to add the first file.</p></div>}
  </section>
  <section aria-labelledby="jon-history"><div className="section-title"><h3 id="jon-history">Upload History <span className="hq-count">{assets.length}</span></h3></div>
   <div className="jon-history-tools"><div className="jon-filters" role="group" aria-label="Filter uploads">{(['all','unassigned','assigned'] as const).map(value=><Button key={value} variant={filter===value?'default':'outline'} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value[0].toUpperCase()+value.slice(1)}</Button>)}</div><label className="field jon-search"><span className="sr-only">Search filename or title</span><Input type="search" placeholder="Search filename or title" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
   {history.length?<ul className="jon-history">{history.map(asset=><li key={asset.id}><a href={assetUrl(asset)} target="_blank" rel="noreferrer" aria-label={'Open '+assetTitle(asset)}><AssetPreview asset={asset}/></a><div className="jon-history-info"><a className="jon-file-title" href={assetUrl(asset)} target="_blank" rel="noreferrer">{assetTitle(asset)} ↗</a><span className="hq-meta">{uploadedDate(asset)}</span><span className="jon-destination"><AssignmentDestination asset={asset} workspace={workspace}/></span></div><AssignmentState asset={asset}/><div className="jon-row-actions"><a href={assetUrl(asset)} target="_blank" rel="noreferrer" aria-label={'Preview '+assetTitle(asset)}>Preview</a><Button variant="outline" onClick={()=>setSelected(asset)} aria-label={`${assignedAsset(asset)?'Change assignment for':'Assign'} ${assetTitle(asset)}`}>{assignedAsset(asset)?'Change assignment':'Assign'}</Button></div></li>)}</ul>:<p className="jon-empty">{assets.length?'No uploads match. Try another search or filter.':'Your uploaded files will appear here.'}</p>}
  </section>
  {selected&&<AssignmentDialog key={selected.id} asset={selected} workspace={workspace} onClose={()=>setSelected(null)} onSaved={asset=>{onSaved(asset);setNotice(assignedAsset(asset)?'Assignment saved.':'Content is now unassigned.');notifyWorkspaceChanged();}}/>}
 </div>;
}
