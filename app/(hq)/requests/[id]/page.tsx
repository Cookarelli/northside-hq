import {HqRequests} from '@/components/hq-requests';
export const metadata={title:'Request | Northside HQ'};
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <HqRequests id={id}/>;}
