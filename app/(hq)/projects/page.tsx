import {HqNavigationRedirect} from '@/components/hq-navigation-redirect';
import Hub from '@/app/hub';
import {STORE_OPEN_CHECKLIST,STORE_OPEN_CHECKLIST_TAB} from '@/lib/store-opening';
export async function generateMetadata({searchParams}:{searchParams:Promise<{tab?:string}>}) {
 const {tab}=await searchParams;
 return {title:(tab===STORE_OPEN_CHECKLIST_TAB||tab==='launch'?STORE_OPEN_CHECKLIST:'Projects')+' | Northside HQ'};
}
export default async function Page({searchParams}:{searchParams:Promise<{tab?:string}>}) {if((await searchParams).tab==='permissions')return <HqNavigationRedirect area="permissions"/>;return <Hub section="projects"/>;}
