import type {CampaignVerification} from './consignment-review';
import type {ConsignmentMeta} from './consignment';
export type CalendarPostData = {
  title: string;
  date: string;
  timezone?: 'America/Chicago';
  source: string;
  caption: string;
  status: string;
  category?: 'Topical' | 'Release' | 'Brand / educational' | 'Consignment';
  owner?: string;
  platforms?: string[];
  tasks?: string[];
  completedTasks?: string[];
  staffPicks?: string;
  verification?: CampaignVerification;
  assets?: string[];
  consignment?: ConsignmentMeta;
  recurrence?: 'weekly-tuesday';
  references?: string[];
};

export type CalendarPost = {id: string; data: CalendarPostData};

// Treat stored dates as Chicago wall-clock values, independent of browser timezone.
export function calendarDay(date: string) {
  return new Intl.DateTimeFormat('en-US', {weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'})
    .format(new Date(date.slice(0, 10) + 'T12:00:00Z'));
}

export function calendarTime(date: string) {
  const local=calendarLocal(date);
  if(!local||local.length===10)return 'Time not set';
  const [hour, minute] = local.slice(11, 16).split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'p.m.' : 'a.m.'} CT`;
}

export function nextTuesday(time: string, now = new Date()) {
  const chicago = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
  const date = new Date(chicago + 'T12:00:00Z');
  const days = (2 - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + days);
  const currentTime = new Intl.DateTimeFormat('en-GB', {timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(now);
  if (days === 0 && time <= currentTime) date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10) + 'T' + time;
}

// Local values in existing records are already Chicago wall time. Explicit
// offsets represent instants and must be converted before grouping or editing.
export function calendarLocal(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
    const part=(type:string)=>parts.find(p=>p.type===type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)) return null;
  const date=new Date(value.slice(0,10)+'T12:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value.slice(0,10))return null;
  if(value.length>10&&(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59))return null;
  return value;
}
export function calendarGroups(posts: CalendarPost[]) {
  const grouped=new Map<string,CalendarPost[]>(), undated:CalendarPost[]=[];
  for(const post of posts){
    if(post.data.recurrence)continue;
    const local=calendarLocal(post.data.date);
    if(!local){undated.push(post);continue;}
    const day=local.slice(0,10);grouped.set(day,[...(grouped.get(day)||[]),post]);
  }
  return {days:[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>({date,items:items.toSorted((a,b)=>(calendarLocal(a.data.date)||'').localeCompare(calendarLocal(b.data.date)||'')||a.id.localeCompare(b.id))})),undated};
}
export function calendarRelativeDay(day:string,now:Date) {
  const today=calendarLocal(now.toISOString())!.slice(0,10);
  const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  return day===today?'Today':day===tomorrow.toISOString().slice(0,10)?'Tomorrow':'';
}
