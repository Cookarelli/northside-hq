'use client';
import {useEffect,useState} from 'react';
import Hub from '@/app/hub';
import Editorial from '@/app/content-radar/editorial/editorial';
import {Button} from '@/components/ui/button';
export function HqContent(){
 const [view,setView]=useState<'studio'|'posts'>('studio');
 useEffect(()=>{const sync=()=>{const hash=window.location.hash;setView(hash==='#posts'||hash==='#new-post'||hash.startsWith('#post-')?'posts':'studio');};sync();window.addEventListener('hashchange',sync);window.addEventListener('popstate',sync);return()=>{window.removeEventListener('hashchange',sync);window.removeEventListener('popstate',sync);};},[]);
 return <><div className="hq-content-views hq-view-switch" role="group" aria-label="Content area"><Button variant="ghost" aria-pressed={view==='studio'} onClick={()=>{setView('studio');window.history.replaceState(null,'','/content');}}>Content Studio</Button><Button variant="ghost" aria-pressed={view==='posts'} onClick={()=>{setView('posts');window.history.replaceState(null,'','/content#posts');}}>Posts &amp; Reviews</Button></div><div hidden={view!=='studio'}><Hub section="content"/></div><div hidden={view!=='posts'}><Editorial/></div></>;
}
