'use client';
import Editorial from '@/app/content-radar/editorial/editorial';
import {HqWorkspace} from '@/components/hq-workspace';
import {HqSubnavigation,useHqTab} from '@/components/hq-subnavigation';
import {useHqContext} from '@/components/use-hq-context';
import {operationTabs} from '@/lib/hq-tabs';
import {Button} from '@/components/ui/button';
export function HqOperationsPage(){
 const {context,error,reload}=useHqContext();
 const tabs=operationTabs.filter(tab=>tab.id!=='permissions'||context?.admin),active=useHqTab(tabs,'staff');
 if(!context)return <section className="panel">{error?<><p role="alert">{error}</p><Button onClick={reload}>Reload operations</Button></>:<p role="status">Loading operations…</p>}</section>;
 return <><HqSubnavigation tabs={tabs} active={active} label="Operations areas"/>{active==='permissions'?<HqWorkspace area="permissions"/>:<Editorial initialTab="Staff"/>}</>;
}
