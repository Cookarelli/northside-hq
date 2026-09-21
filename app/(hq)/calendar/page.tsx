import Hub from '@/app/hub';
export const metadata = {title: 'Calendar | Northside HQ'};
export default async function Page({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const params = await searchParams;
  const range = params.view === 'overview' ? {from: typeof params.from === 'string' ? params.from : '', to: typeof params.to === 'string' ? params.to : ''} : undefined;
  return <Hub section="calendar" calendarRange={range} openLegacy={params.legacy === '1'}/>;
}
