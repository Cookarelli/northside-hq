import Link from 'next/link';
import {redirect} from 'next/navigation';
import {HqRequests} from '@/components/hq-requests';
export const metadata={title:'Requests | Northside HQ'};
export default async function Page({searchParams}:{searchParams:Promise<{view?:string}>}) {
 const {view}=await searchParams;
 if(view==='editorial') redirect('/content');
 if(view==='staff') redirect('/team');
 return <><nav className="hq-secondary-links" aria-label="Work views"><Link href="/work">Tasks</Link><Link href="/requests" aria-current="page">Requests</Link></nav><HqRequests/></>;
}
