'use client';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useEffect,useRef,type ReactNode} from 'react';
import {selectedTab,tabHref,type HqTab} from '@/lib/hq-tabs';

export function useHqTab(tabs:readonly HqTab[],fallback:string,legacyHashes?:Record<string,string>,legacyTabs?:Record<string,string>){
 const params=useSearchParams(),pathname=usePathname(),router=useRouter();
 const query=params.toString();
 useEffect(()=>{
  const current=new URLSearchParams(query),requested=current.get('tab');
  if(!requested||!legacyTabs||!Object.hasOwn(legacyTabs,requested))return;
  current.set('tab',legacyTabs[requested]);
  router.replace(pathname+'?'+current.toString()+window.location.hash,{scroll:false});
 },[legacyTabs,pathname,query,router]);
 useEffect(()=>{
  if(!legacyHashes)return;
  const migrate=()=>{if(new URLSearchParams(window.location.search).has('tab'))return;
   let hash=window.location.hash.slice(1);try{hash=decodeURIComponent(hash);}catch{/* Preserve malformed historical fragments without interrupting navigation. */}
   const legacy=(Object.hasOwn(legacyHashes,hash)?legacyHashes[hash]:undefined)||(hash.startsWith('legacy-entry-')?legacyHashes['legacy-entry-']:undefined);
   if(legacy)router.replace(tabHref(pathname,query,legacy)+window.location.hash,{scroll:false});
  };
  migrate();window.addEventListener('hashchange',migrate);return()=>window.removeEventListener('hashchange',migrate);
 },[legacyHashes,pathname,query,router]);
 return selectedTab(tabs,params.get('tab'),fallback,legacyTabs);
}

// These are page links, not in-memory ARIA tabs: native link keyboard behavior,
// open-in-new-tab, bookmarking and browser history all remain available.
export function useActiveNavigation<T extends HTMLElement=HTMLElement>(active:string){
 const ref=useRef<T>(null);
 useEffect(()=>{
  const nav=ref.current;if(!nav)return;
  const revealActive=()=>{const link=nav.querySelector<HTMLElement>('[aria-current="page"]');if(!link||nav.scrollWidth<=nav.clientWidth)return;const bounds=nav.getBoundingClientRect(),item=link.getBoundingClientRect();if(item.left<bounds.left||item.right>bounds.right)nav.scrollLeft+=item.left-bounds.left-8;};
  revealActive();
  const observer=new ResizeObserver(revealActive);observer.observe(nav);
  return()=>observer.disconnect();
 },[active]);
 return ref;
}
export function HqSubnavigation({tabs,active,label,queryKey='tab'}:{tabs:readonly HqTab[];active:string;label:string;queryKey?:string}){
 const pathname=usePathname(),params=useSearchParams(),ref=useActiveNavigation<HTMLDivElement>(active),more=useRef<HTMLDetailsElement>(null);
 const secondary=tabs.length>4?tabs.filter(tab=>tab.secondary):[];
 const primary=tabs.filter(tab=>!secondary.includes(tab));
 const selected=secondary.find(tab=>tab.id===active),hasSecondary=secondary.length>0;
 useEffect(()=>{
  if(!hasSecondary)return;
  const close=(event:PointerEvent)=>{if(!more.current?.contains(event.target as Node)&&more.current)more.current.open=false;};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&more.current?.open){more.current.open=false;more.current.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
 },[hasSecondary]);
 const link=(tab:HqTab)=><Link key={tab.id} href={tabHref(pathname,params.toString(),tab.id,queryKey)} scroll={false} aria-current={active===tab.id?'page':undefined} onClick={event=>{if(more.current?.contains(event.currentTarget)){more.current.open=false;more.current.querySelector('summary')?.focus();}}}>{tab.label}</Link>;
 return <nav className="hq-subnavigation-bar" aria-label={label}><div ref={ref} className="hq-subnavigation">{primary.map(link)}</div>{secondary.length>0&&<details ref={more} className="hq-more-tabs"><summary aria-current={selected?'page':undefined} aria-label={'More '+label.toLowerCase()+(selected?': '+selected.label:'')}>{selected?.label||'More'} <span aria-hidden="true">⌄</span></summary><div className="hq-more-tab-links">{secondary.map(link)}</div></details>}</nav>;
}
export function HqTabPanel({value,active,children}:{value:string;active:string;children:ReactNode}){return value===active?<div className="hq-tab-panel">{children}</div>:null;}
