import type {ReactNode} from 'react';
import {STORE_OPEN_CHECKLIST,STORE_OPENING,STORE_OPENING_INSTANT,STORE_OPENING_DATE_LABEL,STORE_OPENING_TIME_LABEL} from '@/lib/store-opening';

export function StoreOpeningMilestone({children}:{children?:ReactNode}) {
  return <section className="panel store-opening-hub" aria-labelledby="store-open-checklist-heading">
    <div><h2 id="store-open-checklist-heading">{STORE_OPEN_CHECKLIST}</h2>
      <p className="muted">Add the projects and deliverables each department needs to finish before opening.</p>
      {children}
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
