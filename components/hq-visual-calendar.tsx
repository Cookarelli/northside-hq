'use client';
import {useState} from 'react';
import Link from 'next/link';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {EmptyState,SectionHeader,StatCard} from '@/components/hq-ui';
import {OverviewDate} from '@/components/hq-overview';
import {useHqClock} from '@/components/use-hq-clock';
import {chicagoWall} from '@/lib/consignment';
import {addDays} from '@/lib/hq-operations';
import {overviewAgenda,type OverviewSources} from '@/lib/hq-overview';
import {calendarWindow,moveCalendar,agendaCategory,type AgendaCategory} from '@/lib/hq-sections';
const categories:AgendaCategory[]=['Content','Auction','Release','Event','Operations'];
export function HqVisualCalendar({sources,onLegacy}:{sources:OverviewSources;onLegacy:()=>void}) {
 const [view,setView]=useState<'week'|'month'>('week'),[anchor,setAnchor]=useState(''),[selected,setSelected]=useState(''),[category,setCategory]=useState<AgendaCategory|''>('');
 const now=useHqClock();
 if(now===null)return <p role="status">Preparing Calendar…</p>;
 const today=chicagoWall(now).slice(0,10),date=anchor||today,range=calendarWindow(date,view);
 const all=overviewAgenda(sources,range.from,range.to),items=all.filter(i=>!category||agendaCategory(i,sources)===category);
 const gridStart=view==='month'?calendarWindow(range.from,'week').from:range.from,gridEnd=view==='month'?calendarWindow(range.to,'week').to:range.to;
 const days:string[]=[];for(let d=gridStart;d<=gridEnd;d=addDays(d,1))days.push(d);
 const focus=selected>=range.from&&selected<=range.to?selected:today>=range.from&&today<=range.to?today:range.from;
 const daily=items.filter(i=>i.date.slice(0,10)===focus);
 const label=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 const change=(direction:number)=>{setAnchor(moveCalendar(date,view,direction));setSelected('');};
 return <div className="hq-calendar-overview">
  <div className="hq-calendar-toolbar"><div className="hq-view-switch" role="group" aria-label="Calendar view"><Button variant="ghost" aria-pressed={view==='week'} onClick={()=>setView('week')}>Week</Button><Button variant="ghost" aria-pressed={view==='month'} onClick={()=>setView('month')}>Month</Button></div><div className="button-row"><Button variant="outline" onClick={()=>{setAnchor(today);setSelected(today);}}>Today</Button><Button variant="ghost" aria-label={'Previous '+view} onClick={()=>change(-1)}><ChevronLeft size={18}/></Button><strong aria-live="polite">{label}</strong><Button variant="ghost" aria-label={'Next '+view} onClick={()=>change(1)}><ChevronRight size={18}/></Button></div></div>
  <div className="hq-stat-grid"><StatCard label={view==='week'?'This Week':'This Month'} value={all.length} description="Posts, deadlines & milestones"/><StatCard label="Content" value={all.filter(i=>agendaCategory(i,sources)==='Content').length}/><StatCard label="Auctions" value={all.filter(i=>agendaCategory(i,sources)==='Auction').length}/><StatCard label="Other Plans" value={all.filter(i=>['Release','Event','Operations'].includes(agendaCategory(i,sources))).length}/></div>
  <section className="panel"><div className="hq-calendar-categories" role="group" aria-label="Calendar categories"><Button variant="ghost" aria-pressed={!category} onClick={()=>setCategory('')}>All items</Button>{categories.map(c=><Button variant="ghost" key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}><span className={'hq-category-dot '+(c==='Auction'?'is-auction':'')} aria-hidden="true"/>{c}</Button>)}</div>
   <div className="hq-calendar-grid" data-view={view}>{days.map(d=>{const rows=items.filter(i=>i.date.slice(0,10)===d),outside=d<range.from||d>range.to;return <button type="button" key={d} disabled={outside} className={'hq-calendar-cell'+(d===today?' is-today':'')+(d===focus?' is-selected':'')} onClick={()=>setSelected(d)} aria-pressed={d===focus} aria-label={d+': '+rows.length+' planned items'}><span className="hq-calendar-cell-date"><span>{new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'))}</span><b>{Number(d.slice(8))}</b>{d===today&&<small>Today</small>}</span><span className="hq-calendar-cell-count">{rows.length} {rows.length===1?'item':'items'}</span>{rows.slice(0,view==='month'?2:3).map(i=><span className="hq-calendar-item" key={i.key}><small>{agendaCategory(i,sources)}</small><strong>{i.title}</strong></span>)}{rows.length>(view==='month'?2:3)&&<small>+{rows.length-(view==='month'?2:3)} more</small>}</button>;})}</div>
  </section>
  <section className="panel" aria-label="Selected day"><SectionHeader title={<OverviewDate value={focus}/>} description={`${daily.length} planned items${category?' · '+category:''}`}/>{daily.length?<ul className="hq-task-rows">{daily.map(i=><li key={i.key}><div><span className="hq-overview-kind">{agendaCategory(i,sources)} · {i.label}</span><h3>{i.title}</h3><OverviewDate value={i.date}/></div><Button asChild variant="outline"><Link href={i.href} onClick={i.href.includes('existing-calendar')?onLegacy:undefined}>Open Details</Link></Button></li>)}</ul>:<EmptyState icon={CalendarDays} title="Nothing planned for this day" description="Add a task or plan a post to give your team a clear schedule." action={<Button asChild><Link href="/work#new-task">Add Task</Link></Button>}/>}</section>
 </div>;
}
