'use client';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useEffect,useRef,type ReactNode} from 'react';
import {selectedTab,tabHref,type HqTab} from '@/lib/hq-tabs';

export function useHqTab(tabs:readonly HqTab[],fallback:string,legacyHashes?:Record<string,string>){
 const params=useSearchParams(),pathname=usePathname(),router=useRouter();
 const query=params.toString();
 useEffect(()=>{
  if(!legacyHashes)return;
  const migrate=()=>{if(new URLSearchParams(window.location.search).has('tab'))return;
   let hash=window.location.hash.slice(1);try{hash=decodeURIComponent(hash);}catch{/* Preserve malformed historical fragments without interrupting navigation. */}
   const legacy=(Object.hasOwn(legacyHashes,hash)?legacyHashes[hash]:undefined)||(hash.startsWith('legacy-entry-')?legacyHashes['legacy-entry-']:undefined);
   if(legacy)router.replace(tabHref(pathname,query,legacy)+window.location.hash,{scroll:false});
  };
  migrate();window.addEventListener('hashchange',migrate);return()=>window.removeEventListener('hashchange',migrate);
 },[legacyHashes,pathname,query,router]);
 return selectedTab(tabs,params.get('tab'),fallback);
}

// These are page links, not in-memory ARIA tabs: native link keyboard behavior,
// open-in-new-tab, bookmarking and browser history all remain available.
export function useActiveNavigation(active:string){
 const ref=useRef<HTMLElement>(null);
 useEffect(()=>{
  const nav=ref.current;if(!nav)return;
  const revealActive=()=>{const link=nav.querySelector<HTMLElement>('[aria-current="page"]');if(!link||nav.scrollWidth<=nav.clientWidth)return;const bounds=nav.getBoundingClientRect(),item=link.getBoundingClientRect();if(item.left<bounds.left||item.right>bounds.right)nav.scrollLeft+=item.left-bounds.left-8;};
  revealActive();
  const observer=new ResizeObserver(revealActive);observer.observe(nav);
  return()=>observer.disconnect();
 },[active]);
 return ref;
}
export function HqSubnavigation({tabs,active,label}:{tabs:readonly HqTab[];active:string;label:string}){
 const pathname=usePathname(),params=useSearchParams(),ref=useActiveNavigation(active);
 return <nav ref={ref} className="hq-subnavigation" aria-label={label}>{tabs.map(tab=><Link key={tab.id} href={tabHref(pathname,params.toString(),tab.id)} scroll={false} aria-current={active===tab.id?'page':undefined}>{tab.label}</Link>)}</nav>;
}
export function HqTabPanel({value,active,children}:{value:string;active:string;children:ReactNode}){return value===active?<div className="hq-tab-panel">{children}</div>:null;}
