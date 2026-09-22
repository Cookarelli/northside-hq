import Link from 'next/link';
import Editorial from '@/app/content-radar/editorial/editorial';
import {HqRequests} from '@/components/hq-requests';
export const metadata={title:'Requests | Northside HQ'};
export default async function Page({searchParams}:{searchParams:Promise<{view?:string}>}) {
 const {view}=await searchParams;
 return <><nav className="button-row hq-secondary-nav" aria-label="Request views"><Link href="/requests" aria-current={!view?'page':undefined}>General requests</Link><Link href="/requests?view=editorial" aria-current={view==='editorial'?'page':undefined}>Editorial queue</Link><Link href="/requests?view=staff" aria-current={view==='staff'?'page':undefined}>Staff access</Link></nav>{view==='editorial'||view==='staff'?<Editorial key={view} initialTab={view==='staff'?'Staff':'Editorial queue'}/>:<HqRequests/>}</>;
}
