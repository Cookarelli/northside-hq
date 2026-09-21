export const hqSections = [
  {id: 'overview', label: 'Overview', href: '/today', description: 'Your team’s priorities, approvals and upcoming work.', group: 'primary'},
  {id: 'work', label: 'Work', href: '/work', description: 'Move tasks forward with clear owners and next steps.', group: 'primary'},
  {id: 'calendar', label: 'Calendar', href: '/calendar', description: 'See what is due and what is planned for publication.', group: 'primary'},
  {id: 'campaigns', label: 'Campaigns', href: '/projects', description: 'Plan campaigns, coordinate deliverables and follow progress.', group: 'primary'},
  {id: 'content', label: 'Content', href: '/content', description: 'Create posts and move editorial work through review.', group: 'primary'},
  {id: 'results', label: 'Results', href: '/results', description: 'Review actual spend, tracked sales and campaign performance.', group: 'primary'},
  {id: 'assets', label: 'Assets', href: '/assets', description: 'Find shared media and prepare files for production.', group: 'secondary'},
  {id: 'team', label: 'Team', href: '/team', description: 'Manage staff access and workspace responsibilities.', group: 'secondary'},
  {id: 'settings', label: 'Settings', href: '/settings', description: 'Workspace preferences, exports and operating guidance.', group: 'secondary'},
] as const;

export type HqSection = typeof hqSections[number]['id'];

// Keep shared links and old bookmarks connected to the same working tools.
export const legacyDestinations: Record<string, string> = {
  today: '/today', projects: '/projects', requests: '/requests', assets: '/assets',
  launch: '/projects#launch', studio: '/assets', calendar: '/calendar',
  tracking: '/projects#tracking', performance: '/results', roadmap: '/settings',
};

export function legacyDestination(hash: string) {
  const key = hash.replace(/^#/, '');
  return Object.hasOwn(legacyDestinations, key) ? legacyDestinations[key] : '/today';
}

export function sectionForPath(pathname: string): HqSection {
  if (pathname.startsWith('/projects/work/') || pathname === '/requests' || pathname.startsWith('/requests/')) return 'work';
  return hqSections.find(section => pathname === section.href || pathname.startsWith(section.href + '/'))?.id || 'overview';
}

export function workspacePath(pathname: string) {
  return pathname === '/' || pathname === '/requests' || pathname.startsWith('/requests/') || hqSections.some(({href}) => pathname === href || pathname.startsWith(href + '/'));
}

export function pageForPath(pathname: string) {
  const section = hqSections.find(item => item.id === sectionForPath(pathname))!;
  if (pathname === '/assets/research') return {...section, title: 'Research & sources', description: 'Find source material and save ideas for content.', breadcrumb: {label: 'Assets', href: '/assets'}};
  if (pathname.startsWith('/projects/work/')) return {...section, title: 'Task details', description: 'Review ownership, production and publishing confirmations.', breadcrumb: {label: 'Work', href: '/work'}};
  if (pathname.startsWith('/projects/')) return {...section, title: 'Campaign details', description: 'Coordinate the brief, budget and related deliverables.', breadcrumb: {label: 'Campaigns', href: '/projects'}};
  if (pathname.startsWith('/requests')) return {...section, title: pathname === '/requests' ? 'Requests' : 'Request details', description: 'Track incoming work and the decisions it needs.', breadcrumb: {label: 'Work', href: '/work'}};
  return {...section, title: section.label, breadcrumb: undefined};
}
