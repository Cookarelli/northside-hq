'use client';
import Editorial from '@/app/content-radar/editorial/editorial';
import {HqWorkspace} from '@/components/hq-workspace';
import {HqSubnavigation,useHqTab} from '@/components/hq-subnavigation';
import {useHqContext} from '@/components/use-hq-context';
import {settingsTabs} from '@/lib/hq-tabs';
import {Button} from '@/components/ui/button';
export function HqSettingsPage(){
 const {context,error,reload}=useHqContext();
 const tabs=settingsTabs.filter(tab=>tab.id!=='permissions'||context?.admin),active=useHqTab(tabs,'staff');
 if(!context)return <section className="panel">{error?<><p role="alert">{error}</p><Button onClick={reload}>Reload settings</Button></>:<p role="status">Loading settings…</p>}</section>;
 return <><HqSubnavigation tabs={tabs} active={active} label="Settings areas"/>{active==='permissions'?<HqWorkspace area="permissions"/>:<Editorial initialTab="Staff"/>}</>;
}
