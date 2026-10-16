import {z} from 'zod';
export const roles = ['scout','creator','quality','publisher','analytics'] as const;
export type AgentRole = typeof roles[number];
export const agentLabels: Record<AgentRole,string> = {scout:'Trend Scout',creator:'Content Creator',quality:'Quality Control',publisher:'Publisher',analytics:'Analytics'};
export const descriptions: Record<AgentRole,string> = {
 scout:'Find ideas in saved Content Radar research and preserve source evidence.',
 creator:'Prepare source-led drafts using the Northside community template.',
 quality:'Check recorded fact verification, source references, duplicates, completeness and rights.',
 publisher:'Hand approved drafts to the shared calendar. Live publication is disabled.',
 analytics:'Collect platform metrics and recommendations when an adapter is connected.',
};
export const command = z.discriminatedUnion('action',[
 z.object({action:z.literal('template'),template:z.enum(['community-source','collector-question'])}).strict(),
 z.object({action:z.enum(['pause','resume']),role:z.enum(roles)}).strict(),
 z.object({action:z.literal('run'),role:z.enum(roles),requestId:z.string().uuid(),queueId:z.string().max(100).optional()}).strict(),
 z.object({action:z.literal('retry'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('approve'),queueId:z.string().min(1).max(100),version:z.number().int().positive()}).strict(),
 z.object({action:z.literal('schedule-agent'),role:z.literal('scout'),enabled:z.boolean(),intervalMinutes:z.number().int().min(60).max(10080)}).strict(),
]);
export type Agent = {role:AgentRole;paused:boolean;config:{intervalMinutes:number;template:string};next_scheduled_at:string|null;schedule_actor:string|null;last_run:Run|null;current_task:{stage:string;attempts:number}|null};
export type Task = {id:string;role:AgentRole;stage:string;state:string;attempts:number;error_code:string|null;available_at:string;created_at:string};
export type Run = {id:string;task_id:string;status:string;started_at:string;finished_at:string|null;duration_ms:number|null;error_code:string|null};
export type Draft = {id:string;version:number;data:{title:string;state:string;calendarDate:string}};
export type Review = {id:string;queue_id:string;version:number;passed:boolean;checks:Record<string,boolean>;created_at:string};
export type Post = {id:string;queue_id:string;version:number;platform:string;state:string;scheduled_at:string;published_at:string|null};
export type Dashboard = {
 role:string;agents:Agent[];tasks:Task[];runs:Run[];ideas:{item_id:string;evidence:{url:string;summary:string};created_at:string}[];
 drafts:Draft[];reviews:Review[];posts:Post[];analytics:{id:string;post_id:string;observed_at:string;metrics:Record<string,number>;recommendations:string}[];
 activity:{id:string;actor:string;event:string;entity_id:string;created_at:string;details:Record<string,unknown>}[];
 workerConfigured:boolean;livePublishing:false;
};
