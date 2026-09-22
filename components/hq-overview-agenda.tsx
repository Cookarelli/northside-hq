'use client';
import Link from 'next/link';
import {Button} from '@/components/ui/button';
import {EmptyState, SectionHeader} from '@/components/hq-ui';
import {OverviewDate} from '@/components/hq-overview';
import {useHqClock} from '@/components/use-hq-clock';
import {chicagoWall, type CampaignRecord} from '@/lib/consignment';
import {overviewAgenda, overviewRange, type OverviewSources} from '@/lib/hq-overview';
import type {Deliverable, HqRecord, Project} from '@/lib/hq-model';
import type {CalendarPost} from '@/lib/content-calendar';

export function HqOverviewAgenda({range, records, projects, posts, campaigns, launch, onLegacy}: {range: {from: string; to: string}; records: HqRecord<Deliverable>[]; projects: HqRecord<Project>[]; posts: CalendarPost[]; campaigns: CampaignRecord[]; launch?: OverviewSources['launch']; onLegacy: () => void}) {
  const now = useHqClock();
  if (now === null) return <p role="status">Loading the calendar…</p>;
  const {from, to} = overviewRange(range.from, range.to, chicagoWall(now).slice(0, 10));
  const items = overviewAgenda({work: records, projects, posts, campaigns, launch}, from, to);
  return <section className="panel" aria-label="Overview calendar view">
    <SectionHeader title="All scheduled activity" description={`${items.length} items · Posts, task deadlines and campaign milestones · Central time`} action={<Link href="/calendar">Detailed Calendar</Link>}/>
    <form action="/calendar" className="hq-agenda-dates"><input type="hidden" name="view" value="overview"/>
      <label className="field"><span>From date</span><input type="date" name="from" defaultValue={from} key={'from:' + from} required/></label>
      <label className="field"><span>Through date</span><input type="date" name="to" defaultValue={to} key={'to:' + to} required/></label><Button variant="outline" type="submit">Show Dates</Button>
    </form>
    {items.length ? <ul className="hq-deliverables">{items.map(item => <li key={item.key}><div><span className="hq-overview-kind">{item.label}</span><h3>{item.title}</h3><OverviewDate value={item.date}/></div><Button asChild variant="outline"><Link href={item.href} onClick={item.href.includes('existing-calendar') ? onLegacy : undefined}>Open {item.label === 'Task due' ? 'Task' : item.label.includes('post') || item.label === 'Publishing activity' ? 'Post' : 'Campaign'}</Link></Button></li>)}</ul> : <EmptyState title="Nothing scheduled for these dates" description="Choose another date range or add work from the Overview."/>}
  </section>;
}
