import {redirect} from 'next/navigation';
import Hub from '@/app/hub';
export const metadata = {title: 'Projects | Northside HQ'};
export default async function Page({searchParams}:{searchParams:Promise<{tab?:string}>}) {if((await searchParams).tab==='permissions')redirect('/operations?tab=permissions');return <Hub section="projects"/>;}
