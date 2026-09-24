export const hqSections = [
  {id: 'today', label: 'Home', href: '/today', description: 'Your assignments, deadlines and team updates.'},
  {id: 'calendar', label: 'Calendar', href: '/calendar', description: 'Production and publishing, on one shared schedule.'},
  {id: 'projects', label: 'Projects', href: '/projects', description: 'Plan campaigns, prepare deliverables and follow the work.'},
  {id: 'assets', label: 'Assets', href: '/assets', description: 'Shared photos, videos and source material.'},
] as const;

export type HqSection = typeof hqSections[number]['id'];
export const hqSettings = {id: 'settings', label: 'Settings', href: '/settings', description: 'Staff access and workspace permissions.'} as const;
const within = (pathname:string,base:string) => pathname===base||pathname.startsWith(base+'/');
export function hasWorkspaceHeader(pathname:string) {
  return pathname==='/'||hqSections.some(section=>within(pathname,section.href))||['/settings','/operations','/assignments','/requests'].some(base=>within(pathname,base));
}
export const legacyDestinations: Record<string, string> = {
  today: '/today', projects: '/projects', requests: '/requests', assets: '/assets',
  launch: '/projects?tab=store-open-checklist', 'store-open-checklist':'/projects?tab=store-open-checklist', studio: '/assets', 'video-cutting':'/assets', cutting:'/assets', calendar: '/calendar',
  tracking: '/projects?tab=tracking', performance: '/projects?tab=performance', roadmap: '/projects',
  assignments:'/today?tab=my-work', 'my-assignments':'/today?tab=my-work',
  operations:'/settings', staff:'/settings?tab=staff', permissions:'/settings?tab=permissions',
};

export function legacyDestination(hash: string) {
  const key = hash.replace(/^#/, '');
  return Object.hasOwn(legacyDestinations, key) ? legacyDestinations[key] : '/today';
}

export function sectionForPath(pathname: string): HqSection|'settings' {
  if(within(pathname,'/settings')||within(pathname,'/operations'))return 'settings';
  return hqSections.find(section => pathname === section.href || pathname.startsWith(section.href + '/'))?.id || 'today';
}

export type RelocatedArea = 'assignments'|'settings'|'staff'|'permissions';
// Keep unrelated filters, repeated query values and record fragments on old bookmarks.
export function relocatedHref(area:RelocatedArea,query:string,hash='') {
  const params=new URLSearchParams(query);
  if(area==='assignments') {
    const view=params.get('tab')||params.get('view')||'active';
    params.set('tab','my-work');params.set('assignment',view);params.delete('view');
  } else {
    if(area!=='settings')params.set('tab',area);
    else if(!params.has('tab')&&params.has('view'))params.set('tab',params.get('view')!);
    params.delete('view');
  }
  const search=params.toString();
  return (area==='assignments'?'/today':'/settings')+(search?'?'+search:'')+hash;
}
