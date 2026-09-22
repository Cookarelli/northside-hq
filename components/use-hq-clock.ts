'use client';
import {useSyncExternalStore} from 'react';
const subscribe=(notify:()=>void)=>{const timer=setInterval(notify,60000);window.addEventListener('focus',notify);return()=>{clearInterval(timer);window.removeEventListener('focus',notify);};};
const snapshot=()=>Math.floor(Date.now()/60000)*60000;
const serverSnapshot=()=>null;
export function useHqClock(){return useSyncExternalStore(subscribe,snapshot,serverSnapshot);}
