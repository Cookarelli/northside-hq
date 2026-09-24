import {Suspense} from 'react';
import {HqNavigationRedirect} from '@/components/hq-navigation-redirect';
export default function Page(){return <Suspense fallback={<p>Opening Settings…</p>}><HqNavigationRedirect area="staff"/></Suspense>;}
