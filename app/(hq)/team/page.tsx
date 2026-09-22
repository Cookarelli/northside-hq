import Editorial from '@/app/content-radar/editorial/editorial';
import {HqWorkspace} from '@/components/hq-workspace';
export const metadata = {title: 'Team | Northside HQ'};
export default function Page() {return <><Editorial initialTab="Staff"/><HqWorkspace listMode="team"/></>;}
