import type {Project} from './hq-model';

// Decorative accents only; labels always use these tested dark-on-light pairs.
export const ownerColors = {
  consignment: {label:'Consignment', accent:'#7e22ce', background:'#f3e8ff', text:'#581c87'},
  nik: {label:'Nik', accent:'#b91c1c', background:'#fee2e2', text:'#7f1d1d'},
  nick: {label:'Nick', accent:'#1d4ed8', background:'#dbeafe', text:'#1e3a8a'},
  zach: {label:'Zach', accent:'#15803d', background:'#dcfce7', text:'#14532d'},
  ceo: {label:'CEO', accent:'#eab308', background:'#fef9c3', text:'#713f12'},
  jon: {label:'Jon', accent:'#0f766e', background:'#ccfbf1', text:'#134e4a'},
  steve: {label:'Steve', accent:'#c2410c', background:'#ffedd5', text:'#7c2d12'},
  unassigned: {label:'Other / unassigned', accent:'#64748b', background:'#f1f5f9', text:'#334155'},
} as const;
export function ownerColor(owner:string, name=owner, consignment=false) {
  if(consignment) return ownerColors.consignment;
  // Stable roster IDs: Joey is CEO; Brody owns Consignment (editorial-model roster).
  const aliases:Record<string,keyof typeof ownerColors>={joey:'ceo',brody:'consignment',nikb:'nik'};
  for(const value of [owner,name]) {
    const key=value.trim().toLowerCase().split(/\s+/)[0];
    if(Object.hasOwn(aliases,key)) return ownerColors[aliases[key]];
    if(Object.hasOwn(ownerColors,key)) return ownerColors[key as keyof typeof ownerColors];
  }
  return ownerColors.unassigned;
}
export function projectColor(project:Project, name:(id:string)=>string) {
  return ownerColor(project.owner,name(project.owner),!!project.legacyCampaignId || project.type==='weekly_auction');
}
