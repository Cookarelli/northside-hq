import {z} from 'zod';
import type {Deliverable,HqRecord} from './hq-model';

export const maxBudgetCents=999999999999;
const cents=z.number().int().min(0).max(maxBudgetCents).nullable();
export const deliverableBudgetInput=z.object({plannedBudgetCents:cents,actualSpendCents:cents}).strict();
export type DeliverableBudgetInput=z.infer<typeof deliverableBudgetInput>;
export const deliverableBudgetCommand=z.object({action:z.literal('deliverable-budget'),id:z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),version:z.number().int().min(1),data:deliverableBudgetInput}).strict();
export function parseUsd(value:string):number|null {
 const text=value.trim();if(!text)return null;
 if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(text))throw new Error('Enter a nonnegative USD amount with up to two decimal places.');
 const [whole,fraction='']=text.split('.'),amount=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
 if(amount>BigInt(maxBudgetCents))throw new Error('The amount is too large.');
 return Number(amount); // Exact integer conversion after the safe bound check.
}
export function usdInput(cents:number|null|undefined){if(cents==null)return '';const n=BigInt(cents);return `${n/BigInt(100)}.${String(n%BigInt(100)).padStart(2,'0')}`;}
export function usd(cents:number|bigint){const n=BigInt(cents),absolute=n<BigInt(0)?-n:n;return `${n<BigInt(0)?'-':''}$${new Intl.NumberFormat('en-US').format(absolute/BigInt(100))}.${String(absolute%BigInt(100)).padStart(2,'0')}`;}
export function budgetVariance(planned:number|bigint|null|undefined,actual:number|bigint|null|undefined){return planned==null||actual==null?null:BigInt(planned)-BigInt(actual);}
export function varianceLabel(variance:bigint|null){return variance===null?'Not available':variance===BigInt(0)?'On budget':`${usd(variance<BigInt(0)?-variance:variance)} ${variance<BigInt(0)?'over':'under'} budget`;}
export function budgetTotals(records:HqRecord<Deliverable>[]){
 let planned=BigInt(0),actual=BigInt(0),unbudgeted=0,pending=0,count=0;
 for(const {data:d} of records){if(d.deletedAt)continue;count++;if(d.plannedBudgetCents==null)unbudgeted++;else planned+=BigInt(d.plannedBudgetCents);if(d.actualSpendCents==null)pending++;else actual+=BigInt(d.actualSpendCents);}
 return {planned,actual,variance:planned-actual,unbudgeted,pending,count};
}
