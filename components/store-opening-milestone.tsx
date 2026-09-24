'use client';
import {HqPageActions} from '@/components/hq-page-actions';
import {useHqClock} from '@/components/use-hq-clock';
import type {ReactNode} from 'react';
import {storeOpeningCountdown} from '@/lib/store-opening';

export function StoreOpeningMilestone({children}:{children?:ReactNode}) {
  const countdown=storeOpeningCountdown(useHqClock());
  return <div className="store-opening-hub">
    {children&&<HqPageActions>{children}</HqPageActions>}
    {countdown&&<p className="hq-meta store-opening-countdown">{countdown}</p>}
  </div>;
}
