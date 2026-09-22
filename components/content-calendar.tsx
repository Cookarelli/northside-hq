'use client';

import {ConsignmentReview, OutstandingTasks} from '@/components/consignment-review';
import {approvalIssues} from '@/lib/consignment-review';
import {ConsignmentCampaign, ProductionFields} from '@/components/consignment-campaign';
import type {CampaignRecord, CampaignSave} from '@/lib/consignment';
import {useEffect, useRef, useState} from 'react';
import {CalendarDays, Download, Pencil, Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {templateSaveSchema,type TemplateSave} from '@/lib/calendar-validation';
import {clientId} from '@/lib/client-id';
import {PLATFORMS} from '@/lib/marketing';
import {calendarDay, calendarTime, calendarLocal, calendarGroups, calendarRelativeDay, nextTuesday, type CalendarPost, type CalendarPostData} from '@/lib/content-calendar';

type Props = {onSaveTemplate:(payload:TemplateSave)=>Promise<{id:string;existing:boolean}|null>; campaigns: CampaignRecord[]; onSaveCampaign: (payload: CampaignSave) => Promise<boolean>; posts: CalendarPost[]; busy: boolean; loading: boolean; loadError?: string; saveError?: string; onSave: (id: string, data: CalendarPostData) => Promise<boolean>};
const emptyDraft: CalendarPostData = {title: '', date: '', timezone: 'America/Chicago', source: 'tbd', caption: '', status: 'draft', category: 'Topical'};
const categories = ['Topical', 'Release', 'Brand / educational', 'Consignment'] as const;

function exportCalendar(posts: CalendarPost[], campaigns: CampaignRecord[]) {
  const rows = [['Date / recurrence', 'Time (Central)', 'Category', 'Title', 'Platform', 'Status', 'Caption and production notes', 'References', 'Owner', 'Platforms', 'Production tasks', 'Asset references', 'Consignment metadata', 'Campaign details', 'Completed tasks', 'Staff picks', 'Verification'],
    ...posts.map(({data: p}) => [p.recurrence ? 'Every Tuesday' : (calendarLocal(p.date)?.slice(0,10)||p.date), calendarTime(p.date), p.category || '', p.title, p.source === 'tbd' ? 'To confirm' : p.source, p.status, p.caption, (p.references || []).join('\n'), p.owner || '', (p.platforms || [p.source]).join(', '), (p.tasks || []).join('\n'), (p.assets || []).join('\n'), p.consignment ? JSON.stringify(p.consignment) : '', p.consignment ? JSON.stringify(campaigns.find(c => c.id === p.consignment?.campaignId)?.data || {}) : '', (p.completedTasks || []).join('\n'), p.staffPicks || '', JSON.stringify(p.verification || {})])];
  const csv = rows.map(row => row.map(value => {
    const text = /^[=+@\-]/.test(value) ? "'" + value : value;
    return '"' + text.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'northside-content-calendar.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ContentCalendar({posts, campaigns, busy, loading, loadError, saveError, onSave, onSaveCampaign, onSaveTemplate}: Props) {
  const [draft, setDraft] = useState<CalendarPostData>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [template,setTemplate]=useState<CalendarPost|null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [message,setMessage]=useState('');
  const [now,setNow]=useState<Date|null>(null);
  const [staff,setStaff]=useState<{id:string;name:string}[]>([]);
  const newId=useRef<string|null>(null),saving=useRef(false);
  useEffect(()=>{const update=()=>setNow(new Date());const initial=setTimeout(update,0),timer=setInterval(update,60000);return()=>{clearTimeout(initial);clearInterval(timer);};},[]);
  useEffect(()=>{const controller=new AbortController();fetch('/api/campaigns',{signal:controller.signal}).then(async r=>{if(r.ok){const data=await r.json();setStaff(data.staff||[]);}}).catch(()=>{});return()=>controller.abort();},[]);
  const dated=posts.filter(p=>!p.data.recurrence),recurring=posts.filter(p=>p.data.recurrence).toSorted((a,b)=>a.data.date.slice(11).localeCompare(b.data.date.slice(11)));
  const grouped=calendarGroups(posts);
  const today=now?calendarLocal(now.toISOString())!.slice(0,10):'';
  const days=[...grouped.days,...(today&&!grouped.days.some(d=>d.date===today)?[{date:today,items:[]}]:[])].sort((a,b)=>a.date.localeCompare(b.date));

  function openDraft(post?: CalendarPost, occurrence = false) {
    setMessage('');newId.current=null;
    setEditingId(post && !occurrence ? post.id : null);setTemplate(occurrence&&post?post:null);
    setDraft(post ? {...post.data, date:calendarLocal(post.data.date)||post.data.date, ...(occurrence ? {recurrence: undefined, date: nextTuesday(post.data.date.slice(11, 16)), status: 'draft'} : {})} : {...emptyDraft});
    formRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
    titleRef.current?.focus({preventScroll: true});
  }

  function card(post: CalendarPost) {
    const p = post.data;
    const campaign = campaigns.find(c => c.id === p.consignment?.campaignId)?.data;
    const radar = post.id.startsWith('radar_');
    return <article className="panel calendar-card" key={post.id}>
      <div className="calendar-card-top"><time dateTime={p.date}>{calendarTime(p.date)}</time><span className="tag">{p.category || 'Content'}</span></div>
      <h3>{p.title}</h3>
      <p className="muted calendar-item-meta">{p.platforms?.join(', ') || (p.source === 'tbd' ? 'Platform to confirm' : p.source)} · {p.status}</p>
      <p className="calendar-item-meta">{p.owner?`Assigned to ${staff.find(s=>s.id===p.owner)?.name||(p.owner.match(/^[0-9a-f-]{36}$/i)?'staff member':p.owner)}`:'Unassigned'}{campaign?' · '+campaign.name:p.source&&p.source!=='tbd'?' · Source: '+p.source:''}</p>
      {(p.caption||p.tasks?.length)&&<p className="calendar-notes-preview">{p.caption||p.tasks?.join(' · ')}</p>}
      {p.caption || p.tasks?.length || p.references?.length ? <details><summary>Caption &amp; production notes</summary><p className="calendar-notes">{p.caption}</p>{p.tasks?.length ? <ul className="calendar-references">{p.tasks.map((task, i) => <li key={i}>{task}</li>)}</ul> : null}
        {p.references?.length ? <ul className="calendar-references">{p.references.map((url, i) => <li key={url}><a href={url} target="_blank" rel="noreferrer">Source {i + 1}<span className="sr-only"> for {p.title}</span></a></li>)}</ul> : null}
      </details> : null}
      {p.consignment && <details><summary>Campaign requirements</summary><OutstandingTasks data={p} campaign={campaign}/></details>}
      <div className="calendar-card-actions">{radar ? <Button variant="outline" asChild><a href="/content-radar/editorial">Open editorial review</a></Button> : <>
        <Button variant="outline" disabled={busy||loading||!!loadError} onClick={() => openDraft(post)}><Pencil size={18}/>{p.recurrence ? 'Edit series' : 'Edit draft'}</Button>
        {p.recurrence ? <Button variant="outline" disabled={busy||loading||!!loadError} onClick={() => openDraft(post, true)}><Plus size={18}/>Create next draft</Button> :
          <label className="calendar-status"><span className="sr-only">Status for {p.title}</span><select value={p.status} disabled={busy||loading||!!loadError} onChange={e => void onSave(post.id, {...p, status: e.target.value})}>
            {['draft', 'review', 'approved', 'published'].map(s => <option value={s} key={s} disabled={!!p.consignment && ['approved','published'].includes(s) && approvalIssues(p,campaign).length > 0}>{s}</option>)}
          </select></label>}
      </>}</div>
    </article>;
  }

  return <section className="calendar-workspace" aria-label="Calendar">
    <header className="section-title"><div><h2>Calendar</h2><p className="muted">All times are America/Chicago.</p></div><Button variant="outline" disabled={loading||!!loadError||!posts.length} onClick={()=>exportCalendar([...dated,...recurring],campaigns)}><Download size={18}/>Export calendar</Button></header>
    <form ref={formRef} className="panel calendar-form" onSubmit={async e => {
      e.preventDefault();
      if(saving.current||busy||loading||loadError)return;
      setMessage('');
      if (!draft.title.trim() || !draft.date) return setMessage('Add a title and date.');
      if (draft.recurrence && new Date(draft.date.slice(0, 10) + 'T12:00:00Z').getUTCDay() !== 2) return setMessage('Choose a Tuesday for this weekly series.');
      const issues = approvalIssues(draft, campaigns.find(c => c.id === draft.consignment?.campaignId)?.data);
      if (['approved','published'].includes(draft.status) && issues.length) return setMessage(issues[0] + ' Change the post to review before saving unfinished changes.');
      saving.current=true;newId.current ||= clientId();
      try{const data={...draft, title: draft.title.trim(), timezone: 'America/Chicago' as const};
      const ok = template ? await onSaveTemplate(templateSaveSchema.parse({id:newId.current,templateId:template.id,source:template.data,data})) : await onSave(editingId || newId.current,data);
      if (ok) { setDraft({...emptyDraft}); setEditingId(null);setTemplate(null);newId.current=null;setMessage('Saved. Your calendar is up to date.'); }
      else setMessage('Could not save. Your entries are still here. Please retry.');
      }catch{setMessage('Could not save. Your entries are still here. Please retry.');}finally{saving.current=false;}
    }}>
      <h2>{editingId ? draft.recurrence ? 'Edit Tuesday series' : 'Edit Calendar Item' : 'Add to Calendar'}</h2><p className="muted">Plan a post in Central time. Publishing remains manual.</p>
      <fieldset disabled={busy||loading||!!loadError} className="calendar-editor-fields">
      <div className="calendar-editor-grid"><label className="field"><span>Title</span><Input ref={titleRef} required value={draft.title} onChange={e => setDraft({...draft, title: e.target.value})}/></label>
      <div className="two-fields"><label className="field"><span>{draft.recurrence ? 'First Tuesday and time (Central)' : 'Publish date and time (Central)'}</span><Input required type="datetime-local" value={draft.date} onChange={e => setDraft({...draft, date: e.target.value})}/></label>
        <label className="field"><span>Platform</span><select disabled={!!draft.consignment} value={draft.source} onChange={e => setDraft({...draft, source: e.target.value})}><option value="tbd">To confirm</option>{[...PLATFORMS, 'youtube', 'email'].map(p => <option key={p} value={p}>{p}</option>)}</select></label></div>
      <label className="field"><span>Content type</span><select disabled={!!draft.consignment} value={draft.category || 'Topical'} onChange={e => setDraft({...draft, category: e.target.value as CalendarPostData['category']})}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="field"><span>Caption and production notes</span><Textarea rows={3} value={draft.caption} onChange={e => setDraft({...draft, caption: e.target.value})}/></label>
      </div>
      {draft.consignment && <><ConsignmentReview data={draft} campaign={campaigns.find(c=>c.id===draft.consignment?.campaignId)?.data} onChange={setDraft}/><label className="field"><span>Post status</span><select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}>{['draft','review','approved','published'].map(status=><option key={status} disabled={['approved','published'].includes(status) && approvalIssues(draft,campaigns.find(c=>c.id===draft.consignment?.campaignId)?.data).length>0}>{status}</option>)}</select></label></>}
      {draft.category === 'Consignment' && <ProductionFields data={draft} onChange={data => setDraft({...data, source: data.platforms?.[0] || data.source})}/>}
      <div className="button-row"><Button disabled={busy||loading||!!loadError} type="submit">{busy ? 'Saving…' : editingId ? 'Save changes' : 'Save draft'}</Button>{editingId ? <Button type="button" variant="outline" onClick={() => {setEditingId(null); setDraft({...emptyDraft});}}>Cancel edit</Button> : null}</div>
      </fieldset>
      {(saveError||message)&&<p role={saveError||message.startsWith('Could not')?'alert':'status'} className="notice">{saveError||message}</p>}
    </form>
    <section className="calendar-by-day" aria-labelledby="calendar-by-day-title" aria-busy={loading}>
      <div className="section-title"><h2 id="calendar-by-day-title">Calendar by Day</h2><Button variant="outline" onClick={()=>openDraft()} disabled={busy||loading||!!loadError}><Plus size={18}/>New draft</Button></div>
      {loadError?<p role="alert" className="notice">Calendar could not be loaded. Use Retry above to reload saved items.</p>:loading?<div className="calendar-loading" role="status">Loading saved calendar items…</div>:<>
      {!dated.length&&<p className="notice">Nothing scheduled yet. Add your first dated item above.</p>}
      <div className="calendar-days">{days.map(({date,items})=><section key={date} aria-label={calendarDay(date)}>
        <div className="calendar-day-heading"><CalendarDays size={22} aria-hidden="true"/><h3><span>{new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))}</span>{new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))}<small>{date.slice(0,4)}</small></h3>{now&&calendarRelativeDay(date,now)&&<span className="tag">{calendarRelativeDay(date,now)}</span>}</div>
        {items.length?<div className="calendar-post-grid">{items.map(card)}</div>:<p className="calendar-empty-day">Nothing scheduled for this day.</p>}
      </section>)}</div>
      {grouped.undated.length>0&&<section><h3>Date needs review</h3><p className="muted">These saved items have an unavailable date. Edit them to choose a day.</p><div className="calendar-post-grid">{grouped.undated.map(card)}</div></section>}
      {recurring.length>0&&<section className="calendar-recurring" aria-labelledby="weekly-series"><h2 id="weekly-series">Every Tuesday</h2><p className="muted">Weekly series. Create the next dated draft when ready; publishing stays manual.</p><div className="calendar-post-grid">{recurring.map(card)}</div></section>}
      </>}
    </section>
    <details className="panel calendar-campaign-tools"><summary>Consignment campaigns · plan or edit all five stages</summary><ConsignmentCampaign posts={posts} campaigns={campaigns} disabled={busy||loading||!!loadError} onSave={onSaveCampaign}/></details>
  </section>;
}
