import {chicagoInstant} from './consignment.ts';

export const STORE_OPEN_CHECKLIST = 'Store Open Checklist';
export const STORE_OPEN_CHECKLIST_TAB = 'store-open-checklist';
export const STORE_OPEN_CHECKLIST_HREF = '/projects?tab=store-open-checklist';
// Keep the original identity so saved settings and historical references stay together.
export const STORE_OPEN_PLAN_ID = 'launch';
export const STORE_OPENING = {date:'2026-11-20',time:'15:00',timeZone:'America/Chicago'} as const;
export const STORE_OPENING_WALL = `${STORE_OPENING.date}T${STORE_OPENING.time}`;
export const STORE_OPENING_INSTANT = chicagoInstant(STORE_OPENING_WALL);
export const STORE_OPENING_DATE_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone:STORE_OPENING.timeZone,weekday:'long',month:'long',day:'numeric',year:'numeric',
}).format(STORE_OPENING_INSTANT);
export const STORE_OPENING_TIME_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone:STORE_OPENING.timeZone,hour:'numeric',minute:'2-digit',timeZoneName:'short',
}).format(STORE_OPENING_INSTANT);
export const STORE_OPEN_PLAN_FIELDS = {
  title:STORE_OPEN_CHECKLIST,launchDate:STORE_OPENING.date,
  launchTime:STORE_OPENING.time,launchTimezone:STORE_OPENING.timeZone,
};
export function storeOpenPlan<T extends Record<string,unknown>>(saved:T) {
  return {...saved,...STORE_OPEN_PLAN_FIELDS};
}
