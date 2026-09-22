'use client';

import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {legacyDestination} from '@/lib/hq-navigation';

// Preserve bookmarked fragments: the server cannot see the original tab hash.
export function HqEntry() {
  const router = useRouter();
  useEffect(() => {router.replace(legacyDestination(window.location.hash));}, [router]);
  return <p role="status">Opening Northside HQ…</p>;
}
