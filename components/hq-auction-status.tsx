'use client';
import {useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {auctionStatus,auctionStatuses,auctionStatusOptions,auctionStatusCommand,publicationSummary,type AuctionStatus} from '@/lib/auction-deliverables';
import {canWork,approvalCurrent,deliverableMissing,type Deliverable,type HqContext,type HqRecord,type Project} from '@/lib/hq-model';
import {calendarDay,calendarTime} from '@/lib/content-calendar';
import {scheduleWall} from '@/lib/consignment';
import type {Action} from '@/components/hq-workspace';

export function AuctionStatusControl({record,project,context,act,busy}:{record:HqRecord<Deliverable>;project:Project;context:HqContext;act:Action;busy:boolean}) {
 const d=record.data,id=useId(),current=auctionStatus(d,project),options=auctionStatusOptions(d,project,context);
 const [intent,setIntent]=useState<'scheduled'|'published'|null>(null),[error,setError]=useState('');
 const eligible=canWork(d,project,context);
 const confirmed=d.platforms.some(platform=>['scheduled','published'].includes(d.publications[platform]?.status));
 const missing=d.status==='needs_review'?deliverableMissing(d,project):[];
 async function change(value:AuctionStatus){
  setError('');if(value==='scheduled'||value==='published'){setIntent(value);return;}
  setIntent(null);const command=auctionStatusCommand(value,record);
  if(command&&!(await act(command)))setError('Status was not saved. Review the message above and try again.');
 }
 return <div className="hq-auction-status">
  <label className="field" htmlFor={id}><span>Status</span><select id={id} aria-label={'Status for '+d.title} value={current} disabled={busy||!options.length} onChange={e=>void change(e.target.value as AuctionStatus)}>
   {Object.entries(auctionStatuses).map(([value,label])=><option key={value} value={value} disabled={value!==current&&!options.includes(value as AuctionStatus)}>{label}</option>)}
  </select></label>
  {publicationSummary(d)&&<p className="hq-meta">{publicationSummary(d)}</p>}
  {d.status==='to_do'&&<p className="hq-meta">Start production, then mark Ready for Review.</p>}
  {d.status==='needs_review'&&<p className="hq-meta">Assigned deliverable staff, project members, and administrators can approve this version.{!!missing.length&&' Complete the required content before approval.'}</p>}
  {!!missing.length&&<details className="hq-details"><summary>Needed for approval ({missing.length})</summary><ul>{missing.map(item=><li key={item}>{item}</li>)}</ul></details>}
  {d.status==='ready'&&!approvalCurrent(d,project)&&<p className="hq-meta">The content or project changed. Submit this version for review again.</p>}
  {d.status==='ready'&&!eligible&&<p className="hq-meta">Assigned staff or an administrator records scheduling and publication.</p>}
  {confirmed&&eligible&&!intent&&!['completed','archived'].includes(project.status)&&<Button type="button" variant="outline" disabled={busy} onClick={()=>setIntent(current==='published'?'published':'scheduled')}>Platform confirmations</Button>}
  {intent&&eligible&&!['completed','archived'].includes(project.status)&&<section className="hq-auction-confirmations" aria-label={'Platform confirmations for '+d.title}>
   <div className="section-title"><h4>{intent==='scheduled'?'Confirm scheduling':'Confirm publication'}</h4><Button type="button" variant="outline" disabled={busy} onClick={()=>setIntent(null)}>Close confirmations</Button></div>
   <p className="hq-meta">Confirm each destination after checking it on the platform. These controls record completed actions.</p>
   <div className="hq-project-grid">{d.platforms.map(platform=><AuctionPublicationForm key={platform+':'+intent+':'+d.version} record={record} project={project} platform={platform} intent={intent} act={act} busy={busy}/>)}</div>
  </section>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}

function AuctionPublicationForm({record,project,platform,intent,act,busy}:{record:HqRecord<Deliverable>;project:Project;platform:string;intent:'scheduled'|'published';act:Action;busy:boolean}) {
 const d=record.data,p=d.publications[platform]||{status:'planned'};
 const [time,setTime]=useState(intent==='scheduled'?scheduleWall(p.scheduledFor||d.publishAt):''),[url,setUrl]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[cancel,setCancel]=useState(false),[error,setError]=useState('');
 const allowed=d.status==='ready'&&!d.blocked&&approvalCurrent(d,project);
 if(p.status==='published')return <article className="hq-auction-platform"><h5>{platform}</h5><p>Published{p.publishedAt?' · '+calendarDay(p.publishedAt)+' · '+calendarTime(p.publishedAt):''}</p>{p.liveUrl&&<a href={p.liveUrl} target="_blank" rel="noreferrer">Open live post</a>}</article>;
 return <form className="hq-auction-platform hq-form" onSubmit={async e=>{e.preventDefault();setError('');if(!(await act({action:'publication',id:record.id,version:d.version,platform,status:cancel?'planned':intent,time:cancel?'':time,url,unavailableReason:reason,confirmed})))setError('This confirmation was not saved. Check the details and try again.');}}>
  <h5>{platform}</h5><p className="hq-meta">Currently {p.status}{p.scheduledFor?' · '+calendarDay(p.scheduledFor)+' · '+calendarTime(p.scheduledFor):''}</p>
  <fieldset disabled={busy} className="campaign-fields">
   {p.status==='scheduled'&&<label className="check-field"><input type="checkbox" checked={cancel} onChange={e=>{setCancel(e.target.checked);setConfirmed(false);}}/>Record a cancelled schedule</label>}
   {!cancel&&<label className="field"><span>{intent==='scheduled'?'Scheduled time':'Actual publication time'} (America/Chicago)</span><Input type="datetime-local" required value={time} onChange={e=>setTime(e.target.value)}/></label>}
   {!cancel&&intent==='published'&&<><label className="field"><span>Live post link</span><Input type="url" value={url} onChange={e=>setUrl(e.target.value)}/></label>{!url&&<label className="field"><span>Reason a live link is unavailable</span><Textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}</>}
   <label className="check-field"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{cancel?'I cancelled this schedule':intent==='published'?'I checked that this post is live':'I checked that this post is scheduled'} on {platform}.</label>
   <Button type="submit" disabled={!confirmed||(!cancel&&!allowed)}>Confirm {cancel?'cancellation':intent==='published'?'Published':'Scheduled'} · {platform}</Button>
   {!allowed&&!cancel&&<p className="hq-meta">Current approval is required before confirming this action.</p>}
  </fieldset>{error&&<p role="alert">{error}</p>}
 </form>;
}
