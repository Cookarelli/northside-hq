'use client';
import {ConsignmentReview} from '@/components/consignment-review';
import {approvalIssues} from '@/lib/consignment-review';
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {clientId} from '@/lib/client-id';
import type {CalendarPost, CalendarPostData} from '@/lib/content-calendar';
import {calendarDay, calendarTime} from '@/lib/content-calendar';
import {type Campaign, type CampaignRecord, type CampaignSave, generateCampaign, rescheduleCampaign, scheduleWarnings, stageNames, stages, updateProduction} from '@/lib/consignment';
import {campaignSchema, campaignSaveSchema, socialPlatforms} from '@/lib/calendar-validation';

type Staff = {id: string; name: string};
export function ProductionFields({data, onChange, staff = []}: {data: CalendarPostData; onChange: (data: CalendarPostData) => void; staff?: Staff[]}) {
  return <>
    <label className="field"><span>Assigned staff member</span>{staff.length ? <select value={data.owner || ''} onChange={e => onChange({...data, owner:e.target.value})}><option value="">Choose staff</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : <Input value={data.owner || ''} onChange={e => onChange({...data, owner:e.target.value})}/>}</label>
    {(['tasks', 'platforms', 'assets', 'references'] as const).map(field => <label className="field" key={field}><span>{{tasks:'Production tasks (one per line)', platforms:'Social platforms (one per line)', assets:'Asset references / saved asset IDs (one per line)', references:'Direct auction and lot links (HTTPS, one per line)'}[field]}</span><Textarea rows={3} value={(data[field] || []).join('\n')} onChange={e => onChange(updateProduction(data, field, e.target.value))}/></label>)}
  </>;
}
const blank: Campaign = {name:'', opening:'', closing:'', midweek:'', recap:'', auctionPlatform:'', batchUrl:'', cards:[{name:'',url:''}], owner:'', platforms:['facebook','instagram'], testPlatform:''};
type Props = {posts: CalendarPost[]; campaigns: CampaignRecord[]; disabled: boolean; onSave: (payload: CampaignSave) => Promise<boolean>};
export function ConsignmentCampaign({posts, campaigns, disabled, onSave}: Props) {
  const [staff, setStaff] = useState<Staff[]>([]), [staffError, setStaffError] = useState('');
  const [session, setSession] = useState<{id:string; base:CampaignSave['base']} | null>(null);
  const [campaign, setCampaign] = useState<Campaign>(blank);
  const [preview, setPreview] = useState<CalendarPost[]>([]), [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {if (session) nameRef.current?.focus();}, [session]);
  const retry = useRef<{key:string; mutationId:string} | null>(null), savingRef = useRef(false);
  useEffect(() => {const controller = new AbortController(); fetch('/api/campaigns', {signal:controller.signal}).then(async r => {const j = await r.json(); if (!r.ok) throw new Error(j.error); setStaff(j.staff);}).catch(e => {if (!controller.signal.aborted) setStaffError(e.message);}); return () => controller.abort();}, []);
  function open(record?: CampaignRecord) {
    setSession({id:record?.id || clientId(), base:{campaign:record?.data || null, posts:record ? posts.filter(p => p.data.consignment?.campaignId === record.id) : []}});
    setCampaign(record?.data || {...blank, cards:[{name:'',url:''}]}); setPreview([]); setPreviewCampaign(null); setError(''); retry.current = null;
  }
  function buildPreview() {
    try {
      const parsed = campaignSchema.safeParse(campaign);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      if (!session) return;
      const next = previewCampaign ? rescheduleCampaign(previewCampaign, campaign, preview) : session.base.campaign ? rescheduleCampaign(session.base.campaign, campaign, session.base.posts) : generateCampaign(session.id, campaign);
      setPreview(next); setPreviewCampaign({...campaign}); setError('');
    } catch(e) {setError((e as Error).message);}
  }
  function editPost(id: string, data: CalendarPostData) {setPreview(current => current.map(p => p.id === id ? {...p, data} : p));}
  let warnings: string[] = [];
  try {if (preview.length) warnings = scheduleWarnings(preview, posts, campaign);} catch {warnings = ['Complete all Chicago dates before saving.'];}
  const current = previewCampaign && JSON.stringify(previewCampaign) === JSON.stringify(campaign);
  return <section className="calendar-recurring" aria-label="Consignment campaigns">
    <Button disabled={disabled || saving} onClick={() => open()}>Add consignment campaign</Button>
    {campaigns.length > 0 && <div className="button-row">{campaigns.map(c => <Button key={c.id} variant="outline" disabled={disabled || saving} onClick={() => open(c)}>Edit / reschedule {c.data.name}</Button>)}</div>}
    {session && <form className="panel calendar-form" onSubmit={e => {e.preventDefault(); buildPreview();}}>
      <h3>{session.base.campaign ? 'Edit consignment campaign' : 'Add consignment campaign'}</h3>
      <p>All dates and times use America/Chicago. Review the five stages before saving. Publishing remains manual.</p>
      {staffError && <p role="alert">Could not load staff: {staffError}. Reload the calendar to retry.</p>}
      <fieldset disabled={disabled || saving} className="campaign-fields">
        <label className="field"><span>Auction batch name</span><Input ref={nameRef} required value={campaign.name} onChange={e => setCampaign({...campaign,name:e.target.value})}/></label>
        <div className="two-fields">{(['opening','closing','midweek','recap'] as const).map(field => <label className="field" key={field}><span>{{opening:'Listings opening date and time',closing:'Auction closing date and time',midweek:'Midweek posting date and time',recap:'Recap posting date and time'}[field]} (CT)</span><Input required type="datetime-local" value={campaign[field]} onChange={e => setCampaign({...campaign,[field]:e.target.value})}/></label>)}</div>
        <div className="two-fields"><label className="field"><span>Auction platform</span><Input required value={campaign.auctionPlatform} onChange={e => setCampaign({...campaign,auctionPlatform:e.target.value})}/></label><label className="field"><span>Batch URL</span><Input required type="url" value={campaign.batchUrl} onChange={e => setCampaign({...campaign,batchUrl:e.target.value})}/></label></div>
        <h4>Featured cards</h4>{campaign.cards.map((card, i) => <div className="two-fields" key={i}><label className="field"><span>Card {i + 1} name</span><Input required value={card.name} onChange={e => setCampaign({...campaign,cards:campaign.cards.map((c,j) => j === i ? {...c,name:e.target.value} : c)})}/></label><label className="field"><span>Card {i + 1} direct lot URL</span><Input required type="url" value={card.url} onChange={e => setCampaign({...campaign,cards:campaign.cards.map((c,j) => j === i ? {...c,url:e.target.value} : c)})}/></label>{campaign.cards.length > 1 && <Button type="button" variant="outline" onClick={() => setCampaign({...campaign,cards:campaign.cards.filter((_,j) => i !== j)})}>Remove card {i+1}</Button>}</div>)}
        <Button type="button" variant="outline" disabled={campaign.cards.length >= 50} onClick={() => setCampaign({...campaign,cards:[...campaign.cards,{name:'',url:''}]})}>Add featured card</Button>
        <label className="field"><span>Assigned staff member</span><select required value={campaign.owner} onChange={e => setCampaign({...campaign,owner:e.target.value})}><option value="">Choose staff</option>{staff.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <fieldset><legend>Primary social platforms</legend><div className="button-row">{socialPlatforms.map(p => <label key={p}><input type="checkbox" checked={campaign.platforms.includes(p)} onChange={e => setCampaign({...campaign,platforms:e.target.checked ? [...campaign.platforms,p] : campaign.platforms.filter(x => x !== p)})}/> {p}</label>)}</div></fieldset>
        <label className="field"><span>Optional platform to test</span><select value={campaign.testPlatform} onChange={e => setCampaign({...campaign,testPlatform:e.target.value as Campaign['testPlatform']})}><option value="">No test</option>{['youtube','tiktok','snapchat'].map(p => <option value={p} key={p}>{p}</option>)}</select></label>
        <div className="button-row"><Button type="submit">{preview.length ? 'Update schedule preview' : 'Preview campaign'}</Button><Button type="button" variant="outline" onClick={() => setSession(null)}>Close</Button></div>
      </fieldset>
      {error && <p role="alert" className="notice error">{error}</p>}
      {preview.length > 0 && <>
        <h3>Proposed schedule</h3>
        <div className="table-scroll"><table className="campaign-summary"><caption>Proposed posting times · America/Chicago</caption><thead><tr><th scope="col">Post</th><th scope="col">Date and time</th><th scope="col">Status</th></tr></thead><tbody>{preview.map(p => <tr key={p.id}><td>{p.data.title}</td><td>{p.data.date ? `${calendarDay(p.data.date)} · ${calendarTime(p.data.date)}` : 'Choose a date'}</td><td>{p.data.status}</td></tr>)}</tbody></table></div>
        <p>Review captions, tasks, owners and links. Date changes preserve staff content and shift each post by its stage’s date change. Previously entered auction facts require re-verification.</p>
        {!current && <p role="status" className="notice">Campaign details changed. Update the schedule preview before saving.</p>}
        {warnings.length > 0 && <div className="notice" role="status"><strong>Schedule needs review</strong><ul>{warnings.map(w => <li key={w}>{w}</li>)}</ul><p>Adjust the proposed posts below. Existing calendar posts will stay in place.</p></div>}
        <fieldset disabled={disabled || saving} className="campaign-fields">
          {stages.map(stage => <section key={stage}><h3>{stageNames[stage]}</h3>{preview.filter(p => p.data.consignment?.stage === stage).map(post => {
            const previous = session.base.posts.find(p => p.id === post.id);
            return <article key={post.id} className="panel calendar-form">
              {previous && previous.data.date !== post.data.date && <p className="notice">Affected post: {calendarDay(previous.data.date)} {calendarTime(previous.data.date)} → {calendarDay(post.data.date)} {calendarTime(post.data.date)}</p>}
              <label className="field"><span>Post title</span><Input value={post.data.title} onChange={e => editPost(post.id,{...post.data,title:e.target.value})}/></label>
              <label className="field"><span>Proposed posting date and time (CT)</span><Input type="datetime-local" value={post.data.date} onChange={e => editPost(post.id,{...post.data,date:e.target.value})}/></label>
              <p>{post.data.date ? `${calendarDay(post.data.date)} · ${calendarTime(post.data.date)}` : 'Choose a date and time'} · {post.data.status}</p>
              {previous && <label className="field"><span>Post status</span><select value={post.data.status} onChange={e => editPost(post.id,{...post.data,status:e.target.value})}>{['draft','review','approved','published'].map(status => <option key={status} disabled={['approved','published'].includes(status) && approvalIssues(post.data, previewCampaign || campaign).length > 0}>{status}</option>)}</select></label>}
              <label className="field"><span>Caption</span><Textarea rows={4} value={post.data.caption} onChange={e => editPost(post.id,{...post.data,caption:e.target.value})}/></label>
              <ConsignmentReview data={post.data} campaign={previewCampaign || campaign} onChange={data => editPost(post.id,data)}/>
              <ProductionFields data={post.data} staff={staff} onChange={data => editPost(post.id,{...data,source:data.platforms?.[0] || 'tbd'})}/>
            </article>;
          })}<Button type="button" variant="outline" disabled={preview.length >= 100} onClick={() => {
            const template = preview.find(p => p.data.consignment?.stage === stage)!; const slot = clientId();
            setPreview([...preview,{id:`consignment_${session.id}_${slot}`,data:{...template.data,title:`${campaign.name} — Additional spotlight`,status:'draft',completedTasks:[],verification:undefined,assets:[],staffPicks:'',consignment:{campaignId:session.id,stage,slot}}}]);
          }}>Add spotlight to {stageNames[stage].toLowerCase()}</Button></section>)}
          <Button type="button" disabled={!current || !!staffError} onClick={async () => {
            if (savingRef.current) return;
            const payload = {id:session.id, campaign, posts:preview, base:session.base}; const key = JSON.stringify(payload);
            if (retry.current?.key !== key) retry.current = {key,mutationId:clientId()};
            const data = {...payload,mutationId:retry.current.mutationId}; const valid = campaignSaveSchema.safeParse(data);
            if (!valid.success) {setError(valid.error.issues[0].message); return;}
            const blocked = valid.data.posts.find(p => ['approved','published'].includes(p.data.status) && !(p.data.status === 'published' && session.base.posts.some(old => old.id === p.id && JSON.stringify(old.data) === JSON.stringify(p.data))) && approvalIssues(p.data,campaign).length);
            if (blocked) {setError(`${blocked.data.title}: ${approvalIssues(blocked.data,campaign)[0]}`); return;}
            savingRef.current = true; setSaving(true); setError('');
            try {if (await onSave(valid.data)) {setSession(null); toast.success('Campaign and posts saved.');}} finally {setSaving(false); savingRef.current = false;}
          }}>{saving ? 'Saving…' : session.base.campaign ? 'Apply reviewed changes' : warnings.length ? 'Save reviewed campaign with warnings' : 'Save campaign and drafts'}</Button>
        </fieldset>
      </>}
    </form>}
  </section>;
}
