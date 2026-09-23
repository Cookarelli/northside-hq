'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {calendarDay,calendarTime,type CalendarPost} from '@/lib/content-calendar';
import {chicagoWall,type CampaignRecord} from '@/lib/consignment';
import type {Deliverable,HqRecord,Project,Staff} from '@/lib/hq-model';
import {personName} from '@/lib/hq-operations';
import {calendarEntries,calendarRange,shiftCalendar,type CalendarView} from '@/lib/hq-calendar';
import {ownerColor,ownerColors,projectColor} from '@/lib/owner-colors';
import {useHqClock} from '@/components/use-hq-clock';
export function HqCalendar({records,projects,posts,campaigns=[],staff}:{records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];posts:CalendarPost[];campaigns?:CampaignRecord[];staff:Staff[]}) {
 const now=useHqClock(),[view,setView]=useState<CalendarView>('month'),[selected,setSelected]=useState('');
 if(now===null)return <section className="panel"><h2>Calendar</h2><p role="status">Loading calendar…</p></section>;
 const today=chicagoWall(now).slice(0,10),day=selected||today,days=calendarRange(day,view),name=(id:string)=>personName(id,staff);
 const entries=calendarEntries(records,projects,posts,campaigns,days[0],days.at(-1)!);
 const label=view==='month'?new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')):view==='day'?calendarDay(day):calendarDay(days[0])+' – '+calendarDay(days[6]);
 return <section className="panel hq-visual-calendar" aria-label="Calendar"><div className="section-title"><h2>Calendar</h2><div className="button-row" role="group" aria-label="Calendar view">{(['month','week','day'] as const).map(v=><Button key={v} variant={view===v?'default':'outline'} aria-pressed={view===v} onClick={()=>setView(v)}>{v[0].toUpperCase()+v.slice(1)}</Button>)}</div></div>
 <div className="section-title"><h3 aria-live="polite">{label}</h3><div className="button-row"><Button variant="outline" aria-label={'Previous '+view} onClick={()=>setSelected(shiftCalendar(day,view,-1))}>←</Button><Button variant="outline" onClick={()=>setSelected(today)}>Today</Button><Button variant="outline" aria-label={'Next '+view} onClick={()=>setSelected(shiftCalendar(day,view,1))}>→</Button></div></div>
 <ul className="hq-owner-legend" aria-label="Owner colors">{Object.values(ownerColors).map(c=><li key={c.label}><span style={{background:c.accent}} aria-hidden="true"/>{c.label}</li>)}</ul>
 <p className="muted">Central time · Select an item to open its work. Planned publication is not a confirmed schedule.</p>
 <div className={'hq-calendar-grid hq-calendar-view-'+view}>{days.map(date=>{const items=entries.filter(e=>e.date.slice(0,10)===date);return <section key={date} className={'hq-calendar-day'+(date===today?' is-today':'')} aria-label={calendarDay(date)}><h4><button type="button" aria-label={'Open '+calendarDay(date)} aria-current={date===today?'date':undefined} onClick={()=>{setSelected(date);setView('day');}}>{new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))}</button>{items.length>0&&<span className="hq-calendar-count">{items.length} {items.length===1?'item':'items'}</span>}</h4><ul>{items.map(e=>{const color=e.projectData?projectColor(e.projectData,name):ownerColor(e.owner,name(e.owner),e.consignment);return <li key={e.key}><Link className="hq-calendar-item" href={e.href} style={{borderColor:color.accent,background:color.background,color:color.text}}><strong>{e.project}</strong><span>{e.title}</span><span>Owner: {name(e.owner)}</span><span>Assigned: {e.assigned.map(name).join(', ')||'Unassigned'}</span><time dateTime={e.date}>{calendarTime(e.date)}</time><span>{e.status}</span></Link></li>;})}</ul>{!items.length&&<p className="muted hq-calendar-empty">No entries</p>}</section>;})}</div>
 {!entries.length&&<p role="status">No dated work in this {view}. Undated work remains in Projects.</p>}
 </section>;
}
