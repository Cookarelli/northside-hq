import {DailyProduction} from '@/components/daily-production';
import {chicagoToday,productionDay} from '@/lib/daily-production';
export const metadata={title:'Daily production | Northside HQ'};
export default async function Page({searchParams}:{searchParams:Promise<{day?:string}>}){const {day}=await searchParams;const parsed=productionDay.safeParse(day);return <DailyProduction key={parsed.success?parsed.data:chicagoToday()} day={parsed.success?parsed.data:chicagoToday()}/>;}
