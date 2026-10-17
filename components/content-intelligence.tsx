'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,CalendarPlus,FilePlus2,RefreshCw,Save} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {HqSubnavigation,useHqTab} from '@/components/hq-subnavigation';
import {campaignKey,categories,templates,metricNames,type Idea,type Label,type MetricName,type Report} from '@/lib/content-intelligence/model';
import type {IntelligenceData} from '@/lib/content-intelligence/repository';
import type {MeasuredPost} from '@/lib/content-intelligence/analytics';
import {chicagoWall} from '@/lib/consignment';
import './content-intelligence.css';

const tabs=[{id:'briefing',label:'Daily briefing'},{id:'performance',label:'Performance'},{id:'summaries',label:'Daily & weekly'},{id:'sync',label:'Sync history'}];
const display=(n:number|null|undefined)=>n===null||n===undefined?'Unavailable':n.toLocaleString('en-US',{maximumFractionDigits:2});
const metricLabels:Record<MetricName,string>={views:'Views',impressions:'Impressions',reach:'Post reach (non-unique total)',likes:'Likes',reactions:'Reactions',comments:'Comments',shares:'Shares',saves:'Saves',paidViews:'Paid views',organicViews:'Organic views',paidImpressions:'Paid impressions',organicImpressions:'Organic impressions',paidReach:'Paid post reach',organicReach:'Organic post reach'};
type Command=Record<string,unknown>;
type RunCommand=(command:Command)=>Promise<boolean>;
export default function Intelligence(){
 const tab=useHqTab(tabs,'briefing');
 const [data,setData]=useState<IntelligenceData|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const [range,setRange]=useState(()=>{const to=chicagoWall(Date.now()).slice(0,10);return {from:new Date(Date.parse(to)-6*86400000).toISOString().slice(0,10),to,channel:'all',category:'all',campaign:''};});
 const [postPage,setPostPage]=useState(0),[selectedReport,setSelectedReport]=useState('');
 useEffect(()=>{const controller=new AbortController();const timer=setTimeout(()=>{setLoading(true);setError('');
  void fetch('/api/content-intelligence?'+new URLSearchParams(range),{signal:controller.signal,cache:'no-store'}).then(async r=>{const result=await r.json();if(!r.ok)throw new Error(result.error||'Reporting unavailable.');return result as IntelligenceData;}).then(result=>{if(!controller.signal.aborted)setData(result);}).catch(e=>{if(!controller.signal.aborted){setData(null);setError((e as Error).message);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},150);
  return()=>{clearTimeout(timer);controller.abort();};
 },[range,revision]);
 const command:RunCommand=async payload=>{setBusy(true);setError('');setNotice('');try{
  const r=await fetch('/api/content-intelligence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),result=await r.json();if(!r.ok||result.error)throw new Error(result.error||'Action unavailable.');
  setNotice(result.skipped?result.reason==='history_complete'?'This history pass is complete.':`Sync is busy or cooling down${result.retryAt?' until '+new Date(result.retryAt).toLocaleTimeString():''}.`:payload.action==='sync'?`Batch saved. ${result.complete?'Pass complete.':'More records remain; continue the next batch.'}`:'Saved.');setRevision(n=>n+1);return true;
 }catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}};
 const disabled=busy||loading;
 const report=(selectedReport&&data?.reports.find(r=>r.id===selectedReport))||data?.reports.find(r=>r.kind==='briefing');
 return <div className="intelligence-desk">
  <nav className="intelligence-links" aria-label="Related work"><Link href="/assets/research">Research & sources</Link><Link href="/requests?tab=editorial">Editorial queue</Link><Link href="/calendar">Calendar</Link><Link href="/projects?tab=performance">Spending records</Link></nav>
  <HqSubnavigation tabs={tabs} active={tab} label="Content intelligence views"/>
  {error&&<div role="alert" className="radar-error">{error} <Button variant="outline" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={16}/>Retry</Button></div>}
  {notice&&<p role="status">{notice}</p>}{loading&&<p role="status">Loading saved evidence...</p>}
  {data?.truncated&&<p role="alert" className="radar-error">Reporting coverage limit reached. Totals are partial; recommendations are withheld. Narrow the reporting dataset before relying on this report.</p>}
  {data&&tab==='briefing'&&<section aria-label="Daily briefing">
   <div className="intelligence-heading"><h2>{report?`Briefing for ${report.report_day}`:'Today\'s briefing'}</h2><Button disabled={disabled} onClick={()=>{setSelectedReport('');void command({action:'generate',kind:'briefing',requestId:crypto.randomUUID()});}}><FilePlus2 size={16}/>Generate briefing</Button></div>
   <label className="field"><span>Saved briefing</span><select value={report?.id||''} onChange={e=>setSelectedReport(e.target.value)}><option value="">Latest</option>{data.reports.filter(r=>r.kind==='briefing').map(r=><option value={r.id} key={r.id}>{r.report_day} · {new Date(r.created_at).toLocaleTimeString('en-US',{timeZone:'America/Chicago'})} CT</option>)}</select></label>
   {!report&&<p className="muted">No saved briefing yet. Research records remain in Content Radar.</p>}
   {report&&<ReportIdeas report={report} busy={disabled} command={command}/>}
  </section>}
  {data&&tab==='performance'&&<section aria-label="Performance analytics">
   <div className="intelligence-filters">
    {(['from','to'] as const).map(k=><label className="field" key={k}><span>{k==='from'?'From':'Through'} (Chicago)</span><Input type="date" value={range[k]} onChange={e=>{setPostPage(0);setRange({...range,[k]:e.target.value});}}/></label>)}
    <label className="field"><span>Channel</span><select value={range.channel} onChange={e=>{setPostPage(0);setRange({...range,channel:e.target.value});}}>{['all','facebook','instagram'].map(v=><option key={v}>{v}</option>)}</select></label>
    <label className="field"><span>Category</span><select value={range.category} onChange={e=>{setPostPage(0);setRange({...range,category:e.target.value});}}>{['all',...categories].map(v=><option key={v}>{v}</option>)}</select></label>
    <label className="field"><span>Campaign / auction</span><select value={range.campaign} onChange={e=>{setPostPage(0);setRange({...range,campaign:e.target.value});}}><option value="">All</option>{data.campaigns.map(c=><option key={campaignKey(c.kind,c.id)} value={campaignKey(c.kind,c.id)}>{c.name}{c.auction?' (auction)':''}</option>)}</select></label>
   </div>
   <p className="muted">{data.result.basis}</p>
   <p>Comparison cohort: {data.result.prior.from} through {data.result.prior.to}. Latest retrieval: {new Date(data.generatedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} CT.</p>
   <div className="table-scroll"><table className="intelligence-table"><caption>Lifetime post metrics and coverage</caption><thead><tr><th>Metric</th><th>Selected cohort</th><th>Previous cohort</th><th>Change</th><th>Available posts</th></tr></thead><tbody>{metricNames.map(k=>{const value=data.result.current[k],delta=data.result.comparison[k];return <tr key={k}><th>{metricLabels[k]}</th><td>{display(value.value)}</td><td>{display(data.result.previous[k].value)}</td><td>{delta?`${display(delta.absolute)} (${delta.percent===null?'no baseline':display(delta.percent)+'%'})`:'Not comparable'}</td><td>{value.covered} / {value.posts}</td></tr>;})}</tbody></table></div>
   <div className="intelligence-groups">{(['channels','categories','campaigns'] as const).map(kind=><section key={kind}><h3>{kind==='campaigns'?'Campaign attribution':kind==='categories'?'Content categories':'Channels'}</h3><ul>{data.result[kind].map(group=><li key={group.name}><strong>{data.campaigns.find(c=>campaignKey(c.kind,c.id)===group.name)?.name||group.name}</strong><span>{group.posts} posts · {display(group.metrics.views.value)} views · {display(group.metrics.shares.value)} shares</span></li>)}</ul></section>)}</div>
   <section className="intelligence-spend"><h3>Spend and reported results</h3><p>{data.spend.rows} reporting rows · Spend ${display(data.spend.spend.value)} · {display(data.spend.clicks.value)} link clicks · Cost per click ${display(data.spend.costPerClick)}</p><p className="muted">{data.spend.attribution} Category filters do not allocate spending. Confirmed sales ROI unavailable: no verified sales/profit attribution is connected.</p>{range.campaign&&<CampaignLink key={range.campaign+':'+(data.campaignLinks.find(l=>campaignKey(l.campaign_kind,l.campaign_id)===range.campaign)?.version||0)} campaignId={range.campaign} data={data} command={command} busy={disabled}/>}</section>
   <h3>Post evidence & attribution</h3>{!data.result.posts.length&&<p>No imported posts in this date range.</p>}
   {data.result.posts.slice(postPage*10,postPage*10+10).map(p=><PostEvidence key={p.page_id+':'+p.platform+':'+p.external_id+':'+(p.label?.version||0)} post={p} data={data} command={command} busy={disabled}/>)}
   {data.result.posts.length>10&&<nav className="button-row" aria-label="Post pages"><Button variant="outline" disabled={!postPage} onClick={()=>setPostPage(n=>n-1)}>Previous</Button><span>Page {postPage+1}</span><Button variant="outline" disabled={(postPage+1)*10>=data.result.posts.length} onClick={()=>setPostPage(n=>n+1)}>Next</Button></nav>}
  </section>}
  {data&&tab==='summaries'&&<section aria-label="Performance summaries">
   <div className="intelligence-heading"><h2>Performance summaries</h2><div className="button-row">{(['daily','weekly'] as const).map(kind=><Button key={kind} disabled={disabled} onClick={()=>void command({action:'generate',kind,requestId:crypto.randomUUID()})}><FilePlus2 size={16}/>Save {kind} summary</Button>)}</div></div>
   {(['daily','weekly'] as const).map(kind=><section className="intelligence-summary" key={kind}><h3>{kind==='daily'?'Today':'Last seven days'}</h3><p>{data[kind].from} through {data[kind].to} · {data[kind].posts.length} posts · {display(data[kind].current.views.value)} views · {display(data[kind].current.shares.value)} shares</p>{!data[kind].recommendations.length&&<p className="muted">Not enough comparable evidence for a recommendation.</p>}{!data.truncated&&data[kind].recommendations.map((r,i)=><p key={i}>Test more <strong>{r.value}</strong> ({r.dimension}, {r.platform}): {r.average.toFixed(1)} shares per post, n={r.sample}; other posts {r.baseline.toFixed(1)}, n={r.baselineSample}. Observation only; audience, spend and post age may differ.</p>)}</section>)}
   <h3>Saved summaries</h3>{data.reports.filter(r=>r.kind!=='briefing').map(r=><details key={r.id} className="intelligence-record"><summary>{r.report_day} · {r.kind} · {r.data.ideas.length} recommendations</summary><ReportIdeas report={r} busy={disabled} command={command}/></details>)}
  </section>}
  {data&&tab==='sync'&&<section aria-label="Meta sync history">
   <h2>Connected accounts</h2>{!data.connections.length&&<p>No Meta Page connected. Complete the approved Meta onboarding before synchronization.</p>}
   {data.connections.map(c=><article className="intelligence-record" key={c.page_id}><h3>{c.name}</h3><p>{c.status}{c.error_code?' · '+c.error_code:''} · Last shared sync {c.last_sync_at?new Date(c.last_sync_at).toLocaleString():'Never'}</p>{(['facebook','instagram'] as const).filter(p=>p==='facebook'||c.instagram_id).map(platform=><div className="intelligence-sync" key={platform}><strong>{platform}</strong>{(['history','current','metrics'] as const).map(mode=><Button variant="outline" key={mode} disabled={disabled||!data.admin||c.status==='disconnected'} onClick={()=>void command({action:'sync',pageId:c.page_id,platform,mode})}><RefreshCw size={16}/>{mode==='history'?'Next history page':mode==='current'?'Current posts batch':'Next post insights'}</Button>)}</div>)}</article>)}
   <h3>Recent sync attempts</h3><div className="table-scroll"><table className="intelligence-table"><thead><tr><th>Started</th><th>Channel</th><th>Pass</th><th>Status</th><th>Records</th><th>Error</th></tr></thead><tbody>{data.runs.map(r=><tr key={r.id}><td>{new Date(r.started_at).toLocaleString()}</td><td>{r.platform}</td><td>{r.mode}</td><td>{r.status}</td><td>{r.records}</td><td>{r.error_code||'None'}</td></tr>)}</tbody></table></div>
   <p className="muted">Read-only manual batches. Publishing, advertising writes and background workers are not activated.</p>
  </section>}
 </div>;
}
function ReportIdeas({report,busy,command}:{report:Report;busy:boolean;command:RunCommand}){return <>{report.data.notes.map((n,i)=><p className="muted" key={i}>{n}</p>)}{report.data.ideas.map(idea=><IdeaRow key={idea.id} idea={idea} reportId={report.id} busy={busy} command={command}/>)}</>;}
function CampaignLink({campaignId,data,command,busy}:{campaignId:string;data:IntelligenceData;command:RunCommand;busy:boolean}){
 const link=data.campaignLinks.find(l=>campaignKey(l.campaign_kind,l.campaign_id)===campaignId),campaign=data.campaigns.find(c=>campaignKey(c.kind,c.id)===campaignId);
 const [key,setKey]=useState(link?.reporting_key||'');
 return <form className="intelligence-actions" onSubmit={e=>{e.preventDefault();if(campaign)void command({action:'campaign-link',campaignId:campaign.id,campaignKind:campaign.kind,reportingKey:key||null,version:link?.version||0});}}><label className="field"><span>Attributed spending campaign</span><select value={key} onChange={e=>setKey(e.target.value)}><option value="">Not attributed</option>{data.reportingKeys.map(k=><option key={k}>{k}</option>)}</select></label><Button variant="outline" disabled={busy||!campaign} type="submit"><Save size={16}/>Save spending attribution</Button></form>;
}
function IdeaRow({idea,reportId,busy,command}:{idea:Idea;reportId:string;busy:boolean;command:RunCommand}){
 const [date,setDate]=useState(idea.window.start);
 return <article className="intelligence-idea"><div className="intelligence-heading"><h3>{idea.headline}</h3><span className="tag">{idea.category}</span></div><p><a href={idea.sourceUrl} target="_blank" rel="noreferrer">Original source <ArrowUpRight size={14}/></a> · Published {idea.publishedAt||'Unknown'} · {idea.verification} · {idea.confidence} confidence</p><p>{idea.whyToday}</p><dl className="intelligence-facts"><div><dt>Proposed window</dt><dd>{idea.window.start.replace('T',' ')} to {idea.window.end.slice(11)} CT</dd></div><div><dt>Template</dt><dd>{idea.template}</dd></div><div><dt>Original images</dt><dd>{idea.originalImagesRequired?'Required':'Not required'}</dd></div><div><dt>Inventory confirmation</dt><dd>{idea.inventoryRequired?'Required':'No availability claim proposed'}</dd></div></dl><p className="muted">{idea.window.basis}</p>
 <div className="intelligence-copy"><section><h4>Facebook</h4><p>{idea.facebook}</p></section><section><h4>Instagram</h4><p>{idea.instagram}</p></section></div><ul>{idea.checks.map(c=><li key={c}>{c}</li>)}</ul>
 <div className="intelligence-actions"><label className="field"><span>Draft time (America/Chicago)</span><Input type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></label><Button variant="outline" disabled={busy||!date} onClick={()=>void command({action:'handoff',reportId,ideaId:idea.id,date,calendar:false})}><Save size={16}/>Send to editorial</Button><Button disabled={busy||!date} onClick={()=>void command({action:'handoff',reportId,ideaId:idea.id,date,calendar:true})}><CalendarPlus size={16}/>Add calendar draft</Button></div></article>;
}
function PostEvidence({post,data,command,busy}:{post:MeasuredPost;data:IntelligenceData;command:RunCommand;busy:boolean}){
 const [label,setLabel]=useState({category:post.label?.category||'Unclassified',template:post.label?.template||'',campaign:post.label?.campaign_id?campaignKey(post.label.campaign_kind!,post.label.campaign_id):''});
 return <details className="intelligence-record"><summary>{post.platform} · {post.caption.slice(0,120)||post.external_id} · {post.label?.category||'Unclassified'}</summary><p>{post.published_at} · {post.media_type} · Observation {post.snapshot?.observed_at||'Unavailable'}</p>{post.url&&<a href={post.url} target="_blank" rel="noreferrer">Published post <ArrowUpRight size={14}/></a>}<p>{post.snapshot?.unavailable.length?'Unavailable: '+post.snapshot.unavailable.join(', '):'No metric errors recorded.'}</p>
  <form className="intelligence-filters" onSubmit={async e=>{e.preventDefault();const campaign=data.campaigns.find(c=>campaignKey(c.kind,c.id)===label.campaign);await command({action:'label',pageId:post.page_id,platform:post.platform,externalId:post.external_id,version:post.label?.version||0,category:label.category,template:label.template||null,campaignId:campaign?.id||null,campaignKind:campaign?.kind||null});}}>
   <label className="field"><span>Content category</span><select value={label.category} onChange={e=>setLabel({...label,category:e.target.value as Label['category']})}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
   <label className="field"><span>Northside template</span><select value={label.template} onChange={e=>setLabel({...label,template:e.target.value})}><option value="">Unknown</option>{templates.map(t=><option key={t}>{t}</option>)}</select></label>
   <label className="field"><span>Campaign / auction attribution</span><select value={label.campaign} onChange={e=>setLabel({...label,campaign:e.target.value})}><option value="">Unattributed</option>{data.campaigns.map(c=><option key={campaignKey(c.kind,c.id)} value={campaignKey(c.kind,c.id)}>{c.name}</option>)}</select></label><Button type="submit" disabled={busy}><Save size={16}/>Save attribution</Button>
  </form><h4>Recent observations</h4><ul>{data.snapshots.filter(s=>s.page_id===post.page_id&&s.platform===post.platform&&s.subject_id===post.external_id).sort((a,b)=>b.observed_at.localeCompare(a.observed_at)).slice(0,10).map(s=><li key={s.id}>{s.observed_at} · {display(s.metrics.views)} views · {display(s.metrics.shares)} shares</li>)}</ul>
 </details>;
}
