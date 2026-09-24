'use client';
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {materialRoles,type MaterialRole,type Project,type Deliverable,type HqRecord} from '@/lib/hq-model';
import {assignedAssetIds} from '@/lib/hq-assets';
import {assetAccept} from '@/lib/asset-policy';
import {auctionCalendarTitle} from '@/lib/auction-campaigns';
import {uploadAsset,type UploadTicket} from '@/lib/asset-upload';
export type Asset={id:string;data:{name:string;type?:string;assignedProjectId?:string;assignedDeliverableId?:string}};
export type Materials={assets:string[];references:string[];assetRoles?:Record<string,MaterialRole>;linkRoles?:Record<string,MaterialRole>};
const path=(id:string)=>'/api/assets/'+encodeURIComponent(id);
function Media({asset}:{asset:Asset}) {
 const [preview,setPreview]=useState(false),[error,setError]=useState(false);
 const supported=asset.data.type?.startsWith('image/')||asset.data.type?.startsWith('video/');
 return <div className="hq-media"><div className="button-row"><a href={path(asset.id)+'?download=1'} target="_blank" rel="noreferrer">Download {asset.data.name}</a>{supported&&<Button type="button" variant="outline" onClick={()=>{setPreview(!preview);setError(false);}}>{preview?'Hide':'Preview'} {asset.data.name}</Button>}</div>
 {preview&&(error?<p role="alert">Preview unavailable. Try downloading the file.</p>:asset.data.type?.startsWith('image/')?
 // Private signed redirects must be fetched in the user's authenticated browser.
 // eslint-disable-next-line @next/next/no-img-element
 <img src={path(asset.id)} alt={asset.data.name} onError={()=>setError(true)}/>:<video src={path(asset.id)} controls preload="metadata" onError={()=>setError(true)}/>)}
 </div>;
}
export function ResourceLinks({assets,references,assetRoles={},linkRoles={},available}:{available:Asset[]}&Materials){return <div className="hq-material-list">{assets.map(id=><article key={id}><p className="tag">{materialRoles[assetRoles[id]||'reference']}</p><Media asset={available.find(a=>a.id===id)||{id,data:{name:'Saved asset'}}}/></article>)}{references.filter(url=>/^https:\/\//.test(url)).map(url=><article key={url}><span className="tag">{materialRoles[linkRoles[url]||'reference']}</span><a href={url} target="_blank" rel="noreferrer">{url}</a></article>)}</div>;}
export function MaterialsEditor({value,onChange,available,onPendingChange,referenceOnly=false}:{value:Materials;onChange:(patch:Materials)=>void;available:Asset[];onPendingChange:(pending:boolean)=>void;referenceOnly?:boolean}) {
 const [local,setLocal]=useState<Asset[]>([]),[file,setFile]=useState<File>(),[uploading,setUploading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[link,setLink]=useState(''),[linkError,setLinkError]=useState('');
 const ticket=useRef<UploadTicket|undefined>(undefined),lock=useRef(false);
 const all=[...available,...local.filter(a=>!available.some(x=>x.id===a.id))];
 const assets=value.assets,references=value.references,assetRoles=value.assetRoles||{},linkRoles=value.linkRoles||{};
 function change(assets:string[],references:string[],ar=assetRoles,lr=linkRoles){onChange({assets,references,assetRoles:Object.fromEntries(Object.entries(ar).filter(([id])=>assets.includes(id))),linkRoles:Object.fromEntries(Object.entries(lr).filter(([url])=>references.includes(url)))});}
 async function upload(selected:File){if(lock.current)return;lock.current=true;setUploading(true);setError('');setMessage('');onPendingChange(true);try{const saved=await uploadAsset(selected,ticket.current,t=>{ticket.current=t;});setLocal(a=>[...a,{id:saved.id,data:saved}]);change([...new Set([...assets,saved.id])],references);setMessage('File uploaded privately. Save this form to attach it.');setFile(undefined);ticket.current=undefined;onPendingChange(false);}catch(e){setError((e as Error).message);}finally{lock.current=false;setUploading(false);}}
 return <details className="hq-details" open={!referenceOnly}><summary>{referenceOnly?'Supporting files or links':'Files and links'}</summary><div className="campaign-fields">
 <p className="muted">Private to your workspace. Images, video, graphics and documents · up to 40 MB.</p>
 <label className="field"><span>{referenceOnly?'Upload a supporting file':'Upload a file (reference, draft or final)'}</span><Input type="file" accept={assetAccept} disabled={uploading||!!file} onChange={e=>{const selected=e.target.files?.[0];if(selected){ticket.current=undefined;setFile(selected);void upload(selected);}e.target.value='';}}/></label>
 {uploading&&<p role="status">Uploading {file?.name}…</p>}{error&&<div role="alert"><p>{file?.name}: {error}</p><div className="button-row"><Button type="button" variant="outline" disabled={uploading} onClick={()=>file&&void upload(file)}>Retry upload</Button><Button type="button" variant="outline" disabled={uploading} onClick={()=>{setFile(undefined);ticket.current=undefined;setError('');onPendingChange(false);}}>Discard unfinished attachment</Button></div></div>}{message&&<p role="status">{message}</p>}
 <fieldset disabled={uploading} className="campaign-fields"><label className="field"><span>Attach an existing file</span><select value="" onChange={e=>e.target.value&&change([...new Set([...assets,e.target.value])],references)}><option value="">Choose a saved file</option>{all.filter(a=>!assets.includes(a.id)).map(a=><option key={a.id} value={a.id}>{a.data.name}</option>)}</select></label>
 {assets.map(id=><div className="hq-material-edit" key={id}><span>{all.find(a=>a.id===id)?.data.name||'Saved asset'}</span>{!referenceOnly&&<label className="field"><span>File role</span><select value={assetRoles[id]||'reference'} onChange={e=>change(assets,references,{...assetRoles,[id]:e.target.value as MaterialRole})}>{Object.entries(materialRoles).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}<Button type="button" variant="outline" onClick={()=>change(assets.filter(x=>x!==id),references)}>Remove attachment</Button></div>)}
 <label className="field"><span>Add an HTTPS link</span><Input type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://…"/></label><Button type="button" variant="outline" disabled={!link.trim()} onClick={()=>{try{const url=new URL(link.trim());if(url.protocol!=='https:'||url.username||url.password)throw new Error();change(assets,[...new Set([...references,url.href])]);setLink('');setLinkError('');}catch{setLinkError('Use an HTTPS link without credentials.');}}}>Attach link</Button>{linkError&&<p role="alert">{linkError}</p>}
 {references.map(url=><div className="hq-material-edit" key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a>{!referenceOnly&&<label className="field"><span>Link role</span><select value={linkRoles[url]||'reference'} onChange={e=>change(assets,references,assetRoles,{...linkRoles,[url]:e.target.value as MaterialRole})}>{Object.entries(materialRoles).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}<Button type="button" variant="outline" onClick={()=>change(assets,references.filter(x=>x!==url))}>Remove link</Button></div>)}
 </fieldset></div></details>;
}

export function AssignedContent({available,kind,id,attached=[]}:{available:Asset[];kind:'project'|'deliverable';id:string;attached?:string[]}){
 const ids=assignedAssetIds(available,kind,id).filter(assetId=>!attached.includes(assetId));
 return ids.length?<div className="hq-assigned-content"><h3>Assigned content</h3><ResourceLinks available={available} assets={ids} references={[]}/><a href="/assets?tab=jons-content">Manage content assignments →</a></div>:null;
}

export function ProjectAssetList({project,deliverables,available}:{project:HqRecord<Project>;deliverables:HqRecord<Deliverable>[];available:Asset[]}){
 const files=[...new Set([...project.data.assets,...assignedAssetIds(available,'project',project.id)])];
 const children=deliverables.filter(d=>d.data.projectId===project.id&&!d.data.deletedAt).map(record=>({record,files:[...new Set([...record.data.assets,...assignedAssetIds(available,'deliverable',record.id)])]})).filter(item=>item.files.length||item.record.data.references.length);
 return <><ResourceLinks {...project.data} assets={files} available={available}/>{!files.length&&!project.data.references.length&&!children.length&&<p className="hq-meta">No files or links yet. Assign content from Jon&apos;s Content or attach files when editing this project.</p>}{children.map(({record,files})=><div key={record.id}><h3>{auctionCalendarTitle(record.data)}</h3><ResourceLinks {...record.data} assets={files} available={available}/></div>)}</>;
}
