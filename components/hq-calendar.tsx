'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {calendarDay,calendarTime,type CalendarPost} from '@/lib/content-calendar';
import {chicagoWall,type CampaignRecord} from '@/lib/consignment';
import type {Deliverable,HqRecord,Project,Staff} from '@/lib/hq-model';
import {primaryOwnerLabel} from '@/lib/project-tasks';
import {personName} from '@/lib/hq-operations';
import {calendarEntries,calendarRange,shiftCalendar,type CalendarView} from '@/lib/hq-calendar';
import {ownerColor,ownerColors,projectColor} from '@/lib/owner-colors';
import {useHqClock} from '@/components/use-hq-clock';
export function HqCalendar({records,projects,posts,campaigns=[],staff}:{records:HqRecord<Deliverable>[];projects:HqRecord<Project>[];posts:CalendarPost[];campaigns?:CampaignRecord[];staff:Staff[]}) {
 const now=useHqClock(),[view,setView]=useState<CalendarView>('month'),[selected,setSelected]=useState('');
 if(now===null)return <section className="panel"><h2>Calendar</h2><p role="status">Loading calendar…</p></section>;
 const today=chicagoWall(now).slice(0,10),day=selected||today,days=calendarRange(day,view),name=(id:string)=>personName(id,staff);
 const entries=calendarEntries(records,projects,posts,campaigns,days[0],days.at(-1)!);
 const byDay=new Map<string,typeof entries>();for(const entry of entries){const key=entry.date.slice(0,10);byDay.set(key,[...(byDay.get(key)||[]),entry]);}
 const colorFor=(e:typeof entries[number])=>e.projectData?projectColor(e.projectData,name):ownerColor(e.owner,name(e.owner),e.consignment);
 const label=view==='month'?new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')):view==='day'?calendarDay(day):calendarDay(days[0])+' – '+calendarDay(days[6]);
 const item=(e:typeof entries[number],detail=false)=><li key={e.key}><Link className="hq-calendar-item" href={e.href} style={{borderLeftColor:colorFor(e).accent}}><strong>{e.title}</strong>{e.project!==e.title&&<span className="hq-calendar-project">{e.project}</span>}<span className="hq-calendar-meta">{primaryOwnerLabel(e.owner,staff)} · <time dateTime={e.date}>{calendarTime(e.date)}</time></span>{detail&&<><span>Assigned: {e.assigned.map(name).join(', ')||'Unassigned'}</span><span>{e.status}{e.endAt?' · Ends '+calendarDay(e.endAt)+' '+calendarTime(e.endAt):''}</span></>}</Link></li>;
 return <section className="panel hq-visual-calendar" aria-label="Calendar"><div className="section-title"><h2>Calendar</h2><div className="button-row hq-view-switch" role="group" aria-label="Calendar view">{(['month','week','day'] as const).map(v=><Button key={v} variant="outline" aria-pressed={view===v} onClick={()=>setView(v)}>{v[0].toUpperCase()+v.slice(1)}</Button>)}</div></div>
 <div className="section-title hq-calendar-toolbar"><h3 aria-live="polite">{label}</h3><div className="button-row"><Button variant="outline" aria-label={'Previous '+view} onClick={()=>setSelected(shiftCalendar(day,view,-1))}>←</Button><Button variant="outline" onClick={()=>setSelected(today)}>Today</Button><Button variant="outline" aria-label={'Next '+view} onClick={()=>setSelected(shiftCalendar(day,view,1))}>→</Button></div></div>
 <ul className="hq-owner-legend" aria-label="Owner colors">{Object.values(ownerColors).map(c=><li key={c.label}><span style={{background:c.accent}} aria-hidden="true"/>{c.label}</li>)}</ul>
 <p className="hq-meta hq-calendar-hint">Central time · Planned publication still needs platform confirmation.</p>
 <div className={'hq-calendar-grid hq-calendar-view-'+view}>{view==='month'&&['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><span className="hq-weekday" key={d} aria-hidden="true">{d}</span>)}{days.map(date=>{const items=byDay.get(date)||[];return <section key={date} className={'hq-calendar-day'+(date===today?' is-today':'')+(date===day?' is-selected':'')+(date.slice(0,7)!==day.slice(0,7)?' is-outside':'')} aria-label={calendarDay(date)}><h4><button type="button" aria-label={calendarDay(date)+', '+items.length+' items'} aria-current={date===today?'date':undefined} aria-pressed={date===day} onClick={()=>setSelected(date)}>{view==='month'?Number(date.slice(8)):new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))}<span className="hq-day-dots" aria-hidden="true">{items.slice(0,3).map(e=><i key={e.key} style={{background:colorFor(e).accent}}/>)}</span></button></h4><ul>{(view==='month'?items.slice(0,2):items).map(e=>item(e,view!=='month'))}</ul>{view==='month'&&items.length>2&&<button className="hq-calendar-more" onClick={()=>{setSelected(date);setView('day');}}>+{items.length-2} more<span className="sr-only"> on {calendarDay(date)}</span></button>}{view!=='month'&&!items.length&&<p className="hq-meta">No scheduled work</p>}</section>;})}</div>
 {view==='month'&&<section className="hq-calendar-agenda" aria-label="Selected date"><div className="section-title"><h3>{calendarDay(day)}{day===today?' · Today':''}</h3><Button variant="outline" onClick={()=>setView('day')}>Day view</Button></div><ul>{(byDay.get(day)||[]).map(e=>item(e,true))}</ul>{!byDay.get(day)?.length&&<p className="hq-meta">No scheduled work on this day.</p>}</section>}
 {!entries.length&&<div className="hq-empty"><p>No dated work this {view}.</p><Link href="/projects">Open projects to schedule a deliverable →</Link></div>}
 </section>;
}
