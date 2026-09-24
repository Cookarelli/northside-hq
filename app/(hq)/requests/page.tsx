import {HqNavigationRedirect} from '@/components/hq-navigation-redirect';
import Editorial from '@/app/content-radar/editorial/editorial';
import {HqRequests} from '@/components/hq-requests';
import {HqSubnavigation} from '@/components/hq-subnavigation';
import {requestTabs,selectedTab} from '@/lib/hq-tabs';
export const metadata={title:'Requests | Northside HQ'};
const editorialViews:Record<string,string>={editorial:'Editorial queue',stories:'Stories','top-stories':'Today’s Top 5',products:'Products'};
export default async function Page({searchParams}:{searchParams:Promise<{tab?:string;view?:string}>}) {
 const {tab,view}=await searchParams;if((tab||view)==='staff')return <HqNavigationRedirect area="staff"/>;const active=selectedTab(requestTabs,tab||view||null,'general');
 return <><HqSubnavigation tabs={requestTabs} active={active} label="Request areas"/>{editorialViews[active]?<Editorial key={active} initialTab={editorialViews[active]}/>:<HqRequests/>}</>;
}
