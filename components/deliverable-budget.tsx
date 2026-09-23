'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {canWork,type Deliverable,type HqContext,type HqRecord,type Project} from '@/lib/hq-model';
import {budgetTotals,budgetVariance,parseUsd,usd,usdInput,varianceLabel} from '@/lib/deliverable-budget';
import type {Action} from '@/components/hq-workspace';

export function BudgetSummary({deliverable:d}:{deliverable:Deliverable}){return <dl className="hq-budget-values"><div><dt>Planned Budget</dt><dd>{d.plannedBudgetCents==null?'Not set':usd(d.plannedBudgetCents)}</dd></div><div><dt>Actual Spend</dt><dd>{d.actualSpendCents==null?'Not recorded':usd(d.actualSpendCents)}</dd></div><div><dt>Remaining / Variance</dt><dd>{varianceLabel(budgetVariance(d.plannedBudgetCents,d.actualSpendCents))}</dd></div></dl>;}
export function BudgetFields({planned,actual,onPlanned,onActual,disabled=false}:{planned:string;actual:string;onPlanned:(v:string)=>void;onActual:(v:string)=>void;disabled?:boolean}){return <fieldset className="campaign-fields hq-budget-fields" disabled={disabled}><legend>Deliverable budget · USD</legend><div className="two-fields"><label className="field"><span>Planned Budget (USD)</span><Input inputMode="decimal" placeholder="150.00" maxLength={13} value={planned} onChange={e=>onPlanned(e.target.value)}/></label><label className="field"><span>Actual Spend (USD, optional)</span><Input inputMode="decimal" placeholder="Not recorded" maxLength={13} value={actual} onChange={e=>onActual(e.target.value)}/></label></div><p className="hq-meta">Actual spend can stay blank until spending occurs. It is not required for publication.</p></fieldset>;}
export function DeliverableBudget({record,project,context,busy,act}:{record:HqRecord<Deliverable>;project?:Project;context:HqContext;busy:boolean;act:Action}){
 const d=record.data,[editing,setEditing]=useState(false);
 if(d.deletedAt)return null;
 return <section className="panel"><h2>Deliverable budget</h2><BudgetSummary deliverable={d}/>{canWork(d,project,context)&&(editing?<BudgetEditor key={d.version} record={record} act={act} busy={busy} onClose={()=>setEditing(false)}/>:<Button variant="outline" onClick={()=>setEditing(true)}>Edit budget and spend</Button>)}</section>;
}
function BudgetEditor({record,act,busy,onClose}:{record:HqRecord<Deliverable>;act:Action;busy:boolean;onClose:()=>void}){
 const [planned,setPlanned]=useState(usdInput(record.data.plannedBudgetCents)),[actual,setActual]=useState(usdInput(record.data.actualSpendCents)),[error,setError]=useState('');
 return <form className="hq-form" onSubmit={async e=>{e.preventDefault();setError('');try{const data={plannedBudgetCents:parseUsd(planned),actualSpendCents:parseUsd(actual)};if(await act({action:'deliverable-budget',id:record.id,version:record.data.version,data}))onClose();}catch(e){setError((e as Error).message);}}}><BudgetFields planned={planned} actual={actual} onPlanned={setPlanned} onActual={setActual} disabled={busy}/>{error&&<p role="alert">{error}</p>}<div className="button-row"><Button disabled={busy}>Save budget</Button><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button></div></form>;
}
export function BudgetRollup({records,label}:{records:HqRecord<Deliverable>[];label:string}){
 const t=budgetTotals(records);
 return <section className="hq-budget-rollup" aria-label={label+' budget totals'}><h4>{label} · Budget totals</h4><dl className="hq-budget-values"><div><dt>Total Planned Budget</dt><dd>{usd(t.planned)}</dd></div><div><dt>Total Actual Spend</dt><dd>{t.pending===t.count?'Not recorded':usd(t.actual)}</dd></div><div><dt>Total Variance</dt><dd>{t.pending===t.count?'Not available':varianceLabel(t.variance)}</dd></div></dl>{(t.pending>0||t.unbudgeted>0)&&<p className="hq-meta">Based on recorded amounts. {t.unbudgeted} deliverable{t.unbudgeted===1?'':'s'} without a planned budget; {t.pending} without actual spend.</p>}</section>;
}
