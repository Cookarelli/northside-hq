'use client';
import Link from 'next/link';
import {useEffect} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {relocatedHref,type RelocatedArea} from '@/lib/hq-navigation';

export function HqNavigationRedirect({area}:{area:RelocatedArea}) {
  const router=useRouter(),query=useSearchParams().toString();
  const href=relocatedHref(area,query),label=area==='assignments'?'Home':'Settings';
  useEffect(()=>{router.replace(relocatedHref(area,query,window.location.hash),{scroll:false});},[area,query,router]);
  return <p role="status">Opening {label}… <Link href={href}>Continue to {label}</Link></p>;
}
