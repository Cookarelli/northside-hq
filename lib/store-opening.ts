import {chicagoInstant} from './consignment.ts';

export const STORE_OPEN_CHECKLIST = 'Store Open Checklist';
export const STORE_OPEN_CHECKLIST_TAB = 'store-open-checklist';
export const STORE_OPEN_CHECKLIST_HREF = '/projects?tab=store-open-checklist';
export const STORE_OPEN_ARCHIVE_HREF = '/projects?tab=archive';
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
export const STORE_OPENED_LABEL = 'Store opened '+new Intl.DateTimeFormat('en-US', {
  timeZone:STORE_OPENING.timeZone,month:'long',day:'numeric',year:'numeric',
}).format(STORE_OPENING_INSTANT)+' at '+STORE_OPENING_TIME_LABEL;
// Sunset is a presentation change. It must never update or close the underlying work.
export function storeHasOpened(now:number|null) {return now!==null&&now>=STORE_OPENING_INSTANT;}
export const STORE_OPEN_PLAN_FIELDS = {
  title:STORE_OPEN_CHECKLIST,launchDate:STORE_OPENING.date,
  launchTime:STORE_OPENING.time,launchTimezone:STORE_OPENING.timeZone,
};
export function storeOpenPlan<T extends Record<string,unknown>>(saved:T) {
  return {...saved,...STORE_OPEN_PLAN_FIELDS};
}

export const STORE_OPENING_TITLE='Northside Store Opens';
export function dueAfterStoreOpening(value:string) {
  if(!value)return false;
  try {const at=/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)?Date.parse(value):chicagoInstant(value);return at>STORE_OPENING_INSTANT;}catch{return false;}
}
export function storeOpeningCountdown(now:number|null) {
  if(now===null)return '';
  const remaining=STORE_OPENING_INSTANT-now;
  if(remaining<=0)return 'Store Opened';
  const days=Math.floor(remaining/86400000),hours=Math.floor(remaining/3600000)%24;
  if(days>=7)return `${days} days until opening`;
  const parts=[days?`${days} ${days===1?'day':'days'}`:'',hours?`${hours} ${hours===1?'hour':'hours'}`:''].filter(Boolean);
  return parts.length?parts.join(', ')+' until opening':'Opening within the hour';
}
