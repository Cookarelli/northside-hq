export const hqSections = [
  {id: 'today', label: 'Today', href: '/today', description: 'Your team’s work, reviews and publishing schedule.'},
  {id: 'projects', label: 'Projects', href: '/projects', description: 'Plan campaigns, prepare deliverables and follow the work.'},
  {id: 'calendar', label: 'Calendar', href: '/calendar', description: 'Production and publishing, on one shared schedule.'},
  {id: 'requests', label: 'Requests', href: '/requests', description: 'Ask for work, track decisions and open editorial review.'},
  {id: 'assets', label: 'Assets', href: '/assets', description: 'Shared media, editing jobs and source material.'},
] as const;

export type HqSection = typeof hqSections[number]['id'];
export const legacyDestinations: Record<string, string> = {
  today: '/today', projects: '/projects', requests: '/requests', assets: '/assets',
  launch: '/projects#launch', studio: '/assets', calendar: '/calendar',
  tracking: '/projects#tracking', performance: '/projects#performance', roadmap: '/projects',
};

export function legacyDestination(hash: string) {
  const key = hash.replace(/^#/, '');
  return Object.hasOwn(legacyDestinations, key) ? legacyDestinations[key] : '/today';
}

export function sectionForPath(pathname: string): HqSection {
  return hqSections.find(section => pathname === section.href || pathname.startsWith(section.href + '/'))?.id || 'today';
}
