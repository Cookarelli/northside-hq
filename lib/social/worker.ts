// The queue owns all state transitions. Future adapters must retain its fencing,
// immutable revision approvals and platform idempotency/reconciliation boundary.
export type Lease = {orgId:string;id:string;token:string;stage:string};
export interface WorkerStore {
 tick():Promise<void>;
 claim():Promise<Lease|null>;
 execute(lease:Lease):Promise<unknown>;
}
export interface PublicationAdapter {
 // Not wired in this release. A timeout is "uncertain", never an automatic resend.
 publish(input:{idempotencyKey:string;platform:string;approvedRevision:number;caption:string;signal:AbortSignal}):Promise<{externalId:string;receipt:Record<string,unknown>}>;
 verify(input:{externalId:string;signal:AbortSignal}):Promise<{confirmed:boolean}>;
}
export interface AnalyticsAdapter {
 collect(input:{externalId:string;signal:AbortSignal}):Promise<{observedAt:string;metrics:Record<string,number>;recommendations:string}>;
}
export async function drain(store:WorkerStore,now=Date.now,admissionBudgetMs=40000) {
 const started=now();let processed=0;
 await store.tick();
 while(processed<8 && now()-started<admissionBudgetMs) {
  const lease=await store.claim();if(!lease)break;
  // If transport fails, do not pretend the task failed: lease recovery decides.
  await store.execute(lease);processed++;
 }
 return {processed};
}
