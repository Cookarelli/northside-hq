// Uploads use the existing private bucket. Public access is limited to checked-in brand files.
export const supportedAssetTypes=['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'] as const;
export const assetSizeLimit=40*1024*1024;
export const publicBrandAssets=['/favicon.svg'] as const;
export function assetProblem(file:{type:string;size:number}) {return !(supportedAssetTypes as readonly string[]).includes(file.type)?'Use a JPG, PNG, WebP, MP4, MOV or WebM file.':file.size<=0||file.size>assetSizeLimit?'Choose a nonempty file up to 40 MB.':'';}
