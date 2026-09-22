import type {CalendarPost} from './content-calendar';
import {chicagoWall} from './consignment.ts';

export function todayWork(posts: CalendarPost[], now: number) {
  const day = chicagoWall(now).slice(0, 10);
  const dated = posts.filter(post => !post.data.recurrence).toSorted((a, b) => a.data.date.localeCompare(b.data.date));
  return {
    day,
    scheduled: dated.filter(post => post.data.date.slice(0, 10) === day),
    review: dated.filter(post => post.data.status === 'review'),
    ready: dated.filter(post => post.data.status === 'approved' && post.data.date.slice(0, 10) <= day),
    overdue: dated.filter(post => post.data.date.slice(0, 10) < day && ['draft', 'review'].includes(post.data.status)),
  };
}
