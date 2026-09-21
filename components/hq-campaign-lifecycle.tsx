import {Check,Circle,ArrowRight} from 'lucide-react';
import {campaignLifecycle,lifecycleNames} from '@/lib/hq-sections';
import type {Deliverable,HqRecord,Project} from '@/lib/hq-model';
export function HqCampaignLifecycle({project,work}:{project:Project;work:HqRecord<Deliverable>[]}) {
 const stages=campaignLifecycle(project,work);
 if(!stages)return null;
 return <ol className="hq-lifecycle" aria-label="Consignment campaign lifecycle">{stages.map(s=><li key={s.stage} className={'is-'+s.state}>{s.complete?<Check size={16} aria-hidden="true"/>:s.state==='current'?<ArrowRight size={16} aria-hidden="true"/>:<Circle size={14} aria-hidden="true"/>}<strong>{lifecycleNames[s.stage]}</strong><span>{s.complete?'Complete':s.missing?'Not added':s.state==='current'?'Current':'Upcoming'}</span></li>)}</ol>;
}
