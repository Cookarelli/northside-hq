import {postSchema} from '@/lib/calendar-validation';
import {listRecords,identity,saveRecord,apiError} from '@/lib/storage';
import {z} from 'zod';
const kinds=z.enum(['plan','post','link','metrics','request']);
const schema=z.object({kind:kinds,id:z.string().min(1).max(180),data:z.record(z.unknown())});
const source=z.enum(['facebook','instagram','x','tiktok','snapchat','google','email','offline']);
const n=z.number().finite().nonnegative();
const validators={
 plan:z.object({budget:z.union([z.literal(1000),z.literal(2000),z.literal(3000),z.literal(5000)]),launchDate:z.string(),address:z.string().max(500),campaign:z.string().min(1).max(150),aov:z.number().positive(),margin:z.number().positive().max(100)}),
 post:postSchema,
 link:z.object({name:z.string().max(500),url:z.string().url().refine(u=>u.startsWith('https://')),source:z.string(),medium:z.string(),campaign:z.string(),content:z.string()}),
 metrics:z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),source,campaign:z.string().min(1).max(150),spend:n,impressions:n.int(),clicks:n.int(),leads:n.int(),onlineOrders:n.int(),onlineRevenue:n,posOrders:n.int(),posRevenue:n}).passthrough(),
 request:z.object({title:z.string().trim().min(1).max(300),description:z.string().max(10000),owner:z.string().max(200),dueDate:z.string().max(10).refine(v=>!v||/^\d{4}-\d{2}-\d{2}$/.test(v)),status:z.enum(['not-started','in-progress','needs-attention','blocked','complete']),notes:z.array(z.object({id:z.string().min(1).max(180),body:z.string().trim().min(1).max(10000),createdAt:z.string().datetime(),author:z.string().min(1).max(200)})).max(500),createdAt:z.string().datetime(),updatedAt:z.string().datetime()})
};
export async function GET(request:Request){try{const owner=await identity();const cursor=Number(new URL(request.url).searchParams.get('cursor')||0);if(!Number.isSafeInteger(cursor)||cursor<0)return Response.json({error:'Invalid page.'},{status:400});return Response.json(await listRecords(owner,cursor),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{const owner=await identity(request);const raw=await request.text();if(Buffer.byteLength(raw)>1500000)return Response.json({error:'Record is too large.'},{status:413});let json;try{json=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON.'},{status:400});}const parsed=schema.safeParse(json);if(!parsed.success)return Response.json({error:'Invalid record.'},{status:400});const {kind,id,data}=parsed.data;const valid=validators[kind].safeParse(data);if(!valid.success)return Response.json({error:'Check the required fields, dates and numbers.'},{status:400});await saveRecord(owner,kind,id,valid.data);return Response.json({ok:true});}catch(e){return apiError(e);}}
