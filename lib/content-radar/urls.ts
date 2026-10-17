// Public link normalization is separate from server fetch authorization.
export function canonicalUrl(value:string, base?:string) {
 const u=new URL(value,base);
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Use a public HTTP(S) link without credentials.');
 u.hash='';
 for(const key of [...u.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','gclid','mc_cid','mc_eid'].includes(key.toLowerCase()))u.searchParams.delete(key);
 u.searchParams.sort();return u.toString();
}
// Only these independently operated publishers are eligible for outbound requests.
// Staff-supplied arbitrary domains (including Instagram) remain manual links.
const groups=[['ripped.topps.com'],['topps.com','www.topps.com'],['beckett.com','www.beckett.com'],['cardboardconnection.com','www.cardboardconnection.com'],['pokebeach.com','www.pokebeach.com'],['pokeguardian.com','www.pokeguardian.com'],['fanaticsinc.com','www.fanaticsinc.com'],['fanaticscollect.com','www.fanaticscollect.com'],['dacardworld.com','www.dacardworld.com'],['steelcitycollectibles.com','www.steelcitycollectibles.com']];
export function fetchUrl(value:string, source:string) {
 const u=new URL(value),s=new URL(source);
 const group=groups.find(g=>g.includes(s.hostname));
 if(u.protocol!=='https:'||u.username||u.password||u.port||!group?.includes(u.hostname)||u.hostname.endsWith('.')||u.href.length>2048)throw new Error('This address is not an approved public publisher. Add the link manually.');
 return u.toString();
}
