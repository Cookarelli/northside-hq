import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from 'node:crypto';
export const READ_SCOPES=['pages_show_list','pages_read_engagement','read_insights','instagram_basic','instagram_manage_insights'] as const;
export type Platform='facebook'|'instagram';
export type MetaConfig={appId:string;appSecret:string;version:string;redirectUri:string;key:Buffer};
export class MetaError extends Error {
 code:string;
 constructor(code:string){super(code);this.name='MetaError';this.code=code;}
}
export function configuration(env:NodeJS.ProcessEnv=process.env):MetaConfig {
 const appId=env.META_APP_ID||'',appSecret=env.META_APP_SECRET||'',version=env.META_GRAPH_VERSION||'v26.0';
 const key=Buffer.from(env.META_TOKEN_ENCRYPTION_KEY||'','base64');
 let redirect:URL;try{redirect=new URL(env.META_REDIRECT_URI||'');}catch{throw new MetaError('meta_configuration_required');}
 if(!/^\d+$/.test(appId)||!appSecret||key.length!==32||!/^v26\.0$/.test(version)||redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.search||redirect.hash||redirect.pathname!=='/api/meta/oauth/callback')throw new MetaError('meta_configuration_required');
 return {appId,appSecret,version,redirectUri:redirect.href,key};
}
export const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/gu,' ').trim();
export const contentHash=(text:string)=>hash(normalize(text));
export function seal(value:unknown,key:Buffer,context:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));
 const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');
}
export function unseal<T>(value:string,key:Buffer,context:string):T {
 try{const [v,iv,tag,data,...rest]=value.split('.');if(v!=='v1'||rest.length)throw Error();const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from(context));decipher.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString());}catch{throw new MetaError('credential_unavailable');}
}
export function oauthURL(c:MetaConfig,state:string){const url=new URL(`https://www.facebook.com/${c.version}/dialog/oauth`);url.search=new URLSearchParams({client_id:c.appId,redirect_uri:c.redirectUri,response_type:'code',state,scope:READ_SCOPES.join(',')}).toString();return url.href;}
export const proof=(token:string,secret:string)=>createHmac('sha256',secret).update(token).digest('hex');
export function objectId(id:string){if(!/^\d+(?:_\d+)?$/.test(id))throw new MetaError('invalid_platform_id');return id;}
export function safePlatformURL(value:unknown,platform:Platform){if(typeof value!=='string')return null;try{const u=new URL(value);const root=platform==='facebook'?'facebook.com':'instagram.com';return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname===root||u.hostname.endsWith('.'+root))?u.href:null;}catch{return null;}}
