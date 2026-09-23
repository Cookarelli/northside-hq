import type {CampaignVerification} from './consignment-review';
import type {ConsignmentMeta} from './consignment';
import {scheduleWall} from './consignment.ts';
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

// Older Topps imports stored noon when the publisher supplied only a date.
// Preserve those records without presenting the placeholder as a confirmed time.
export function isDateOnlyRelease(post: CalendarPostData) {
  return post.category === 'Release' && post.source === 'topps' && post.caption.includes('Topps lists the date only');
}

// Treat stored dates as Chicago wall-clock values, independent of browser timezone.
export function calendarDay(date: string) {
  return new Intl.DateTimeFormat('en-US', {weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'})
    .format(new Date(scheduleWall(date).slice(0, 10) + 'T12:00:00Z'));
}

export function calendarTime(date: string) {
  const [hour, minute] = scheduleWall(date).slice(11, 16).split(':').map(Number);
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
