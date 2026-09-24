import {z} from 'zod';
import {maxBudgetCents,budgetTotals,usd} from './deliverable-budget.ts';
import type {AuctionCampaignData} from './auction-campaigns';
import type {Deliverable,HqRecord} from './hq-model';
export const spendChannels=['Meta','Facebook','Instagram','Google','Creative production','Other'] as const;
const workId=z.string().min(1).max(180),version=z.number().int().min(1);
export const auctionFinanceCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('auction-spend'),id:z.string().uuid(),deliverableId:workId,version,channel:z.enum(spendChannels),amountCents:z.number().int().min(1).max(maxBudgetCents),spentOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),note:z.string().max(2000)}).strict(),
 z.object({action:z.literal('auction-spend-reverse'),id:z.string().uuid(),deliverableId:workId,version,reverses:z.string().uuid(),note:z.string().trim().min(1).max(2000)}).strict(),
 z.object({action:z.literal('auction-reconcile'),id:workId,version,deliverableVersions:z.record(z.string(),version)}).strict(),
]);
export const compactUsd=(cents:number|bigint)=>usd(cents).replace(/\.00$/,'');
export function compactVariance(cents:bigint|null){return cents===null?'Not available':cents===BigInt(0)?'On budget':`${compactUsd(cents<BigInt(0)?-cents:cents)} ${cents<BigInt(0)?'over':'under'}`;}
export function campaignFinancials(c:AuctionCampaignData|undefined,records:HqRecord<Deliverable>[]){
 const work=records.filter(r=>!r.data.deletedAt),totals=budgetTotals(work),budget=c?.campaignBudgetCents==null?(totals.unbudgeted===totals.count?null:totals.planned):BigInt(c.campaignBudgetCents);
 const published=work.filter(({data:d})=>d.platforms.length>0&&d.platforms.every(p=>d.publications[p]?.status==='published')).length;
 const allReminders=[48,24,2].every(h=>work.some(r=>r.data.reminderHours===h));
 const ready=allReminders&&published===work.length&&totals.pending===0;
 return {...totals,budget,published,ready,state:c?.reconciliation?.at?'Reconciled':ready?'Ready':'Open',variance:totals.pending||budget===null?null:budget-totals.actual,unallocated:c?.campaignBudgetCents==null?null:BigInt(c.campaignBudgetCents)-totals.planned};
}
