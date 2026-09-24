import Link from 'next/link';
import {STORE_OPEN_CHECKLIST,STORE_OPENING,STORE_OPENING_INSTANT,STORE_OPENING_DATE_LABEL,STORE_OPENING_TIME_LABEL} from '@/lib/store-opening';

export function StoreOpeningMilestone() {
  return <section className="panel store-opening-hub" aria-labelledby="store-open-checklist-heading">
    <div><h2 id="store-open-checklist-heading">{STORE_OPEN_CHECKLIST}</h2>
      <p className="muted">Coordinate every department’s projects, deliverables, owners and deadlines before the store opens. Keep supporting assets, notes and status updates with the existing work.</p>
      <div className="button-row">
        <Link href="/projects?tab=projects">Open projects →</Link>
        <Link href="/projects?tab=deliverables">Open deliverables →</Link>
        <Link href="/calendar?tab=schedule">Open calendar →</Link>
        <Link href="/assets?tab=all-assets">Open assets →</Link>
      </div>
    </div>
    <div className="store-opening-deadline">
      <p className="eyebrow">PRIMARY DEADLINE</p><h3>Store Opens</h3>
      <time dateTime={new Date(STORE_OPENING_INSTANT).toISOString()}>
        <span>{STORE_OPENING_DATE_LABEL}</span><strong>{STORE_OPENING_TIME_LABEL}</strong>
      </time>
      <p className="hq-meta">{STORE_OPENING.timeZone}</p>
    </div>
  </section>;
}
