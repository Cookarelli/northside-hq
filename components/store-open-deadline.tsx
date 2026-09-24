import {dueAfterStoreOpening} from '@/lib/store-opening';
import {checklistDueState} from '@/lib/store-open-work';

export function StoreOpeningWarning({date}:{date:string}) {
 return dueAfterStoreOpening(date)?<p className="callout" role="status">Due after store opening</p>:null;
}
export function ChecklistDeadline({date,complete,now}:{date:string;complete:boolean;now:number|null}) {
 const state=checklistDueState(date,complete,now);
 return <span className="hq-deadline-indicator" data-state={state}>{state}</span>;
}
