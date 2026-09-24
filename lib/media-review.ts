import type {AssetData} from './asset-upload.ts';
export const mediaStatuses={in_review:'In Review',approved:'Approved',waiting:'Waiting',completed:'Completed'} as const;
export function needsMediaReview(data:Partial<AssetData>){return (data.uploadedBy??data.owner)==='jon'&&/^(image|video)\//.test(data.type||'');}
export function canReviewMedia(staffId:string){return ['joey','steve','brody','nick'].includes(staffId);}
export function mediaStatus(data:Partial<AssetData>){return needsMediaReview(data)?mediaStatuses[data.mediaReview?.status||'in_review']:null;}
