import {assetProblem,assetContentType} from './asset-policy.ts';
export type UploadTicket={id:string;signedUrl:string};
export type AssetData={id:string;name:string;type:string;size:number;title?:string;note?:string;collection?:'jons-content';createdAt?:string;uploadedAt?:string;uploadedBy?:string;assignedProjectId?:string;assignedDeliverableId?:string;assignedBy?:string;assignedAt?:string;assignmentVersion?:number};
export type UploadDetails={collection?:'jons-content';title?:string;note?:string};
async function post(url:string,data:unknown):Promise<Record<string,unknown>> {
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const value=await response.json();if(!response.ok)throw new Error(value.error||'The upload could not be saved.');return value;
}
// Retain the ticket on failure. Retrying finalization first recovers a lost successful response.
export async function uploadAsset(file:File,ticket:UploadTicket|undefined,onTicket:(ticket:UploadTicket)=>void,details:UploadDetails={}):Promise<AssetData> {
 const type=assetContentType(file);
 const problem=assetProblem(file);if(problem)throw new Error(problem);
 const finalize=async(t:UploadTicket)=>(await post('/api/assets/finalize',{id:t.id})).asset as AssetData;
 if(ticket){try{return await finalize(ticket);}catch{/* Bytes may not have reached storage yet. */}}
 else {ticket=await post('/api/assets',{name:file.name,type,size:file.size,...details}) as unknown as UploadTicket;onTicket(ticket);}
 let failure:unknown;
 try {const response=await fetch(ticket.signedUrl,{method:'PUT',headers:{'Content-Type':type},body:file});if(!response.ok)throw new Error('File transfer failed. Retry this upload.');}catch(e){failure=e;}
 try{return await finalize(ticket);}catch(e){throw failure||e;}
}
