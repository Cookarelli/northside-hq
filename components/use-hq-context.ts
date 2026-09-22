'use client';
import {useEffect,useState} from 'react';
import {json} from '@/lib/hq-client';
import type {HqContext} from '@/lib/hq-model';
export function useHqContext(){const [context,setContext]=useState<HqContext|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);useEffect(()=>{const controller=new AbortController();json<HqContext>('/api/hq',{signal:controller.signal}).then(c=>{setContext(c);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[revision]);return {context,error,reload:()=>setRevision(n=>n+1)};}
