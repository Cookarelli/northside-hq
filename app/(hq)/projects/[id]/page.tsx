import {HqWorkspace} from '@/components/hq-workspace';
export const metadata={title:'Project | Northside HQ'};
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <HqWorkspace view="project" id={id}/>;}
