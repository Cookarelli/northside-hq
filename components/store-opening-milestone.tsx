'use client';
import {useHqClock} from '@/components/use-hq-clock';
import type {ReactNode} from 'react';
import {STORE_OPEN_CHECKLIST,STORE_OPENING,STORE_OPENING_INSTANT,STORE_OPENING_DATE_LABEL,STORE_OPENING_TIME_LABEL,STORE_OPENED_LABEL,storeHasOpened,storeOpeningCountdown} from '@/lib/store-opening';

export function StoreOpeningMilestone({children}:{children?:ReactNode}) {
  const now=useHqClock(),opened=storeHasOpened(now),countdown=storeOpeningCountdown(now);
  return <section className="panel store-opening-hub" aria-labelledby="store-open-checklist-heading">
    <div><h2 id="store-open-checklist-heading">{STORE_OPEN_CHECKLIST}</h2>
      <p className="muted">{opened?<time dateTime={new Date(STORE_OPENING_INSTANT).toISOString()}>{STORE_OPENED_LABEL}</time>:'Add the projects and deliverables each department needs to finish before opening.'}</p>
      {children}
    </div>
    <div className="store-opening-deadline">
      <p className="eyebrow">{opened?'LAUNCH ARCHIVE':'PRIMARY DEADLINE'}</p><h3>{opened?'Store Opened':'Store Opens'}</h3>
      {opened?<p className="hq-meta">Remaining work can still be completed.</p>:<>
      <time dateTime={new Date(STORE_OPENING_INSTANT).toISOString()}>
        <span>{STORE_OPENING_DATE_LABEL}</span><strong>{STORE_OPENING_TIME_LABEL}</strong>
      </time>
      <p className="hq-meta">{STORE_OPENING.timeZone}</p>{countdown&&<p className="store-opening-countdown">{countdown}</p>}</>}
    </div>
  </section>;
}
