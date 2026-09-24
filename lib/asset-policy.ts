// All HQ uploads share the existing private bucket and size limit.
export const supportedAssetTypes=[
 'image/jpeg','image/png','image/webp','image/gif','image/svg+xml',
 'video/mp4','video/quicktime','video/webm','application/pdf','text/plain','text/csv',
 'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;
const extensions:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
export const assetAccept=[...supportedAssetTypes,...Object.keys(extensions).map(ext=>'.'+ext)].join(',');
export const assetSizeLimit=40*1024*1024;
export const publicBrandAssets=['/favicon.svg'] as const;
export function assetContentType(file:{type:string;name?:string}) {
 const inferred=extensions[file.name?.split('.').pop()?.toLowerCase()||''];
 // Browsers sometimes supply no MIME type, or application/octet-stream for Office files.
 if(!file.type||file.type==='application/octet-stream'||(inferred==='text/csv'&&file.type==='application/vnd.ms-excel'))return inferred||file.type;
 return file.type;
}
export function assetProblem(file:{type:string;size:number;name?:string}) {return !(supportedAssetTypes as readonly string[]).includes(assetContentType(file))?'Use a supported JPG, PNG, WebP, GIF, SVG, MP4, MOV, WebM, PDF, Office, TXT or CSV file.':!Number.isSafeInteger(file.size)||file.size<=0||file.size>assetSizeLimit?'Choose a nonempty file up to 40 MB.':'';}
