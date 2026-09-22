import Link from 'next/link';
import {HqWorkspace} from '@/components/hq-workspace';
export const metadata = {title: 'Work | Northside HQ'};
export default function Page() {return <><nav className="hq-secondary-links" aria-label="Work views"><Link href="/work" aria-current="page">Tasks</Link><Link href="/requests">Requests</Link></nav><HqWorkspace listMode="work"/></>;}
