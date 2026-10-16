import {createHash} from 'node:crypto';
import {MetaError} from './core.ts';
// Only provider-returned CDN URLs reach this function. Never forward Graph credentials.
export async function mediaFingerprint(value:string,transport:typeof fetch=fetch){
 let url:URL;try{url=new URL(value);}catch{throw new MetaError('media_fingerprint_unavailable');}
 if(url.protocol!=='https:'||url.port||url.username||url.password||!['fbcdn.net','cdninstagram.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))throw new MetaError('media_fingerprint_unavailable');
 try{
  const response=await transport(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(2000)});
  if(!response.ok||!response.body||Number(response.headers.get('content-length')||0)>10*1024*1024)throw Error();
  const reader=response.body.getReader(),digest=createHash('sha256');let bytes=0;
  for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>10*1024*1024){await reader.cancel();throw Error();}digest.update(value);}
  if(!bytes)throw Error();return digest.digest('hex');
 }catch{throw new MetaError('media_fingerprint_unavailable');}
}
