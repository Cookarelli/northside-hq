'use client';

import {useEffect, useMemo, useState} from 'react';
import Link from 'next/link';
import {ArrowRight, CalendarDays, Check, CheckSquare2, Circle, Clock3, FilePlus2, FolderPlus, Upload, TriangleAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Assignee, EmptyState, ProgressBar, QuickAction, SectionHeader, StatCard, StatusBadge} from '@/components/hq-ui';
import {useHqClock} from '@/components/use-hq-clock';
import {json, loadWorkspace, type Workspace} from '@/lib/hq-client';
import {calendarTime} from '@/lib/content-calendar';
import {chicagoWall} from '@/lib/consignment';
import {addDays} from '@/lib/hq-operations';
import {calendarHref, greeting, overviewActivity, overviewAgenda, overviewAttention, overviewCampaigns, overviewSources, shortStages, type CampaignCard, type EditorialOverview} from '@/lib/hq-overview';

export function OverviewDate({value, label}: {value: string; label?: string}) {
  if (!value) return <span>{label ? label + ': ' : ''}Date not set</span>;
  const date = new Date(value.slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime())) return <span>Date unavailable</span>;
  return <time dateTime={value}>{label ? label + ' ' : ''}{new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}).format(date)}{value.length > 10 ? ' · ' + calendarTime(value) : ''}</time>;
}

export function HqOverview() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [editorial, setEditorial] = useState<EditorialOverview | null>(null);
  const [error, setError] = useState(''), [editorialError, setEditorialError] = useState(false);
  const [editorialLimited, setEditorialLimited] = useState(false);
  const [revision, setRevision] = useState(0), [expanded, setExpanded] = useState(false), [allCampaigns, setAllCampaigns] = useState(false);
  const now = useHqClock();
  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([loadWorkspace(controller.signal), json<EditorialOverview>('/api/content-radar/editorial', {signal: controller.signal})]).then(([base, content]) => {
      if (controller.signal.aborted) return;
      if (base.status === 'fulfilled') {setWorkspace(base.value); setError('');}
      else {setWorkspace(null); setError('Your saved workspace could not be loaded.');}
      setEditorial(content.status === 'fulfilled' ? content.value : null);
      setEditorialError(content.status === 'rejected');
      setEditorialLimited(content.status === 'fulfilled' && content.value.records.filter(r => r.kind !== 'team').length >= 1000);
    });
    const refresh = () => setRevision(n => n + 1);
    window.addEventListener('hq-records-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {controller.abort(); window.removeEventListener('hq-records-changed', refresh); window.removeEventListener('focus', refresh);};
  }, [revision]);
  const sources = useMemo(() => workspace ? overviewSources(workspace.records) : null, [workspace]);
  const names = useMemo(() => new Map(workspace?.context.staff.map(p => [p.id, p.name]) || []), [workspace]);
  const person = (id: string) => names.get(id) || (id ? 'Staff member' : 'Unassigned');
  const day = now === null ? '' : chicagoWall(now).slice(0, 10);
  const weekEnd = day ? addDays(day, 6) : '';
  const agenda = sources && day ? overviewAgenda(sources, day, addDays(day, 29)) : [];
  const attention = useMemo(() => sources && now !== null ? overviewAttention(sources, editorial, now) : [], [sources, editorial, now]);
  const campaigns = useMemo(() => sources ? overviewCampaigns(sources) : [], [sources]);
  const activity = useMemo(() => sources && now !== null ? overviewActivity(sources, names, now) : [], [sources, names, now]);
  const firstName = workspace ? names.get(workspace.context.staffId)?.trim().split(/\s+/)[0] : undefined;
  return <div className="hq-overview">
    <header className="hq-page-header hq-overview-header"><div className="hq-page-header-row"><div>
      <p className="eyebrow">Overview</p><h1>Northside HQ</h1>
      {now !== null && <p className="hq-greeting">{greeting(now)}{firstName ? ', ' + firstName : ''}.</p>}
      <p>Here&apos;s what&apos;s happening at Northside.</p>
    </div>{day && <span className="hq-overview-date"><CalendarDays size={17} aria-hidden="true"/><OverviewDate value={day}/><small>Central time</small></span>}</div></header>
    {error ? <section className="panel" role="alert"><EmptyState title="Overview is unavailable" description={error} icon={TriangleAlert} action={<Button onClick={() => setRevision(n => n + 1)}>Retry Overview</Button>}/></section> : !workspace || !sources || now === null ? <div className="panel" role="status">Loading your saved priorities and schedule…</div> : <>
      <div className="hq-stat-grid" aria-label="Overview summary">
        <StatCard label="Today" value={agenda.filter(i => i.date.slice(0, 10) === day).length} description="Posts, deadlines & milestones" icon={CalendarDays} href={calendarHref(day)}/>
        <StatCard label="This Week" value={agenda.filter(i => i.date.slice(0, 10) <= weekEnd).length} description="Scheduled in the next 7 days" icon={CheckSquare2} href={calendarHref(day, weekEnd)}/>
        <StatCard label="Needs Attention" value={attention.length + (editorialError || editorialLimited ? '+' : '')} description={editorialError || editorialLimited ? 'Content review count incomplete' : 'Records with a next step'} icon={TriangleAlert} href="#needs-attention"/>
        <StatCard label="Upcoming" value={agenda.filter(i => i.date.slice(0, 10) > weekEnd).length} description="Scheduled after this week · 30 days" icon={Clock3} href={calendarHref(addDays(day, 7), addDays(day, 29))}/>
      </div>
      <section className="panel hq-overview-attention" id="needs-attention" aria-labelledby="attention-heading">
        <SectionHeader title={<span id="attention-heading">Needs Attention</span>} description={attention.length ? `${attention.length} ${attention.length === 1 ? 'record needs' : 'records need'} a next step${editorialError ? ' · Content reviews unavailable' : ''}` : 'Your next steps, in priority order'} action={<Link href="/work">Open Work <ArrowRight size={16} aria-hidden="true"/></Link>}/>
        {editorialError && <div className="hq-overview-notice" role="status">Content reviews could not be loaded. This count includes the other saved records only. <Button variant="outline" size="sm" onClick={() => setRevision(n => n + 1)}>Retry</Button></div>}
        {editorialLimited && <p className="hq-overview-notice">Older content may also need review. <Link href="/content">Open Content</Link></p>}
        {attention.length ? <ul className="hq-attention-list">{attention.slice(0, expanded ? undefined : 5).map(item => <li key={item.key}>
          <div className="hq-attention-main"><span className="hq-overview-kind">{item.label}</span><h3>{item.title}</h3><p>{item.reason}</p><div className="hq-overview-meta"><Assignee name={person(item.owner)}/><OverviewDate value={item.date}/></div></div>
          <div className="hq-attention-action"><StatusBadge status={item.status}/><Button variant="outline" asChild><Link href={item.href}>{item.action}<ArrowRight size={15} aria-hidden="true"/></Link></Button></div>
        </li>)}</ul> : <EmptyState title={editorialError || editorialLimited ? 'No attention items in the available records' : 'Nothing needs attention'} description={editorialError || editorialLimited ? 'Check Content to complete this view.' : 'No overdue work, pending reviews or incomplete campaign requirements were found.'}/>}
        {attention.length > 5 && <Button className="hq-overview-more" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? 'Show fewer' : `Show all ${attention.length} attention items`}</Button>}
      </section>
      <section className="panel" aria-label="Today and this week">
        <SectionHeader title="Today / This Week" description="The next 7 days · Posts, task deadlines and campaign milestones" action={<Link href={calendarHref(day, weekEnd)}>Open Calendar <ArrowRight size={16} aria-hidden="true"/></Link>}/>
        <div className="hq-week-grid">{Array.from({length: 7}, (_, i) => {
          const date = addDays(day, i), items = agenda.filter(item => item.date.slice(0, 10) === date);
          return <Link className={'hq-week-day' + (i === 0 ? ' is-today' : '')} href={calendarHref(date)} key={date} aria-label={`${date}: ${items.length} scheduled items. Open Calendar.`}>
            <div className="hq-week-day-top"><span>{i === 0 ? 'Today' : new Intl.DateTimeFormat('en-US', {weekday: 'short', timeZone: 'UTC'}).format(new Date(date + 'T12:00:00Z'))}</span><time dateTime={date}>{Number(date.slice(8))}</time></div>
            <strong className="hq-week-count">{items.length}<span>{items.length === 1 ? 'item' : 'items'}</span></strong>
            {items.length > 0 && <ul>{items.slice(0, 2).map(item => <li key={item.key}><span>{item.label}</span><b>{item.title}</b></li>)}</ul>}
            {!items.length && <span className="hq-week-empty">Nothing scheduled</span>}{items.length > 2 && <span className="hq-week-more">+{items.length - 2} more</span>}
          </Link>;
        })}</div>
      </section>
      <section aria-label="Active Campaigns">
        <SectionHeader title="Active Campaigns" description="Progress from saved tasks and campaign stages" action={<Link href="/projects">All Campaigns <ArrowRight size={16} aria-hidden="true"/></Link>}/>
        {campaigns.length ? <div className="hq-overview-campaigns">{campaigns.slice(0, allCampaigns ? undefined : 4).map(campaign => <OverviewCampaign key={campaign.id} campaign={campaign} assignee={person(campaign.owner)}/>)}</div> : <div className="panel"><EmptyState title="No active campaigns" description="Activate a saved campaign or create one to start tracking progress." action={<Link href="/projects">Open Campaigns <ArrowRight size={16} aria-hidden="true"/></Link>}/></div>}
        {campaigns.length > 4 && <Button className="hq-overview-more" variant="ghost" aria-expanded={allCampaigns} onClick={() => setAllCampaigns(v => !v)}>{allCampaigns ? 'Show fewer campaigns' : `Show all ${campaigns.length} campaigns`}</Button>}
      </section>
      <div className="hq-overview-bottom">
        <section className="panel"><SectionHeader title="Quick Actions"/><div className="hq-overview-quick">
          <QuickAction label="Add Task" href="/work#new-task" icon={CheckSquare2}/><QuickAction label="New Campaign" href="/projects#new-campaign" icon={FolderPlus}/><QuickAction label="Create Post" href="/content#new-post" icon={FilePlus2}/><QuickAction label="Upload Asset" href="/assets#upload-asset" icon={Upload}/>
        </div></section>
        <section className="panel"><SectionHeader title="Recent Activity" description="Latest recorded task and campaign changes"/>{activity.length ? <ul className="hq-overview-activity">{activity.map(item => <li key={item.key}><span className="hq-activity-dot" aria-hidden="true"/><div><p>{item.description}</p><Link href={item.href}>{item.title}</Link><time dateTime={item.at}>{new Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(item.at))} CT</time></div></li>)}</ul> : <EmptyState title="No recent activity available" description="Saved task and campaign changes will appear when recorded timestamps are available."/>}</section>
      </div>
    </>}
  </div>;
}

function OverviewCampaign({campaign: c, assignee}: {campaign: CampaignCard; assignee: string}) {
  return <article className="panel hq-overview-campaign"><div className="hq-card-top"><StatusBadge status={c.status} detail={c.label}/><Assignee name={assignee}/></div><h3>{c.title}</h3>
    <div className="hq-overview-meta"><OverviewDate label={c.dateLabel} value={c.opening}/>{c.closing && <OverviewDate label="Closes" value={c.closing}/>}</div>
    {c.total ? <ProgressBar value={c.completed} max={c.total} label={`Completed ${c.unit}`}/> : <p className="muted">No tasks added · Progress unavailable</p>}
    {c.stages && <ol className="hq-campaign-stages" aria-label="Five consignment stages">{c.stages.map(s => <li key={s.stage} className={'is-' + s.state} title={shortStages[s.stage] + ': ' + s.detail}>{s.state === 'complete' ? <Check size={16} aria-hidden="true"/> : <Circle size={14} aria-hidden="true"/>}<strong>{shortStages[s.stage]}</strong><span>{s.detail}</span></li>)}</ol>}
    <div className="hq-campaign-next"><span>Next step</span><p>{c.next}</p><Link href={c.href}>Open Campaign <ArrowRight size={16} aria-hidden="true"/></Link></div>
  </article>;
}
