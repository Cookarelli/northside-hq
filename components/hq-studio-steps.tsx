'use client';
import {Check} from 'lucide-react';
export const studioSteps=['Upload','Review','Edit','Approve','Schedule'];
export function HqStudioSteps({current,complete,onChange}:{current:number;complete:boolean[];onChange:(step:number)=>void}) {
 return <ol className="hq-studio-steps" aria-label="Content workflow">{studioSteps.map((label,i)=><li key={label}><button type="button" aria-current={current===i?'step':undefined} onClick={()=>onChange(i)}><span className={'hq-step-number'+(complete[i]?' is-complete':'')}>{complete[i]?<Check size={16} aria-hidden="true"/>:i+1}</span><span><strong>{label}</strong><small>{current===i?'Current step':complete[i]?'Complete':i===current+1?'Next step':'Not complete'}</small></span></button></li>)}</ol>;
}
