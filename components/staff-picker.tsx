'use client';
import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import type {Staff} from '@/lib/hq-model';
export function StaffPicker({label,value,onChange,staff,disabled=false}:{label:string;value:string[];onChange:(ids:string[])=>void;staff:Staff[];disabled?:boolean}) {
 const [search,setSearch]=useState('');
 const shown=staff.filter(s=>s.name.toLowerCase().includes(search.toLowerCase()));
 const names=new Map(staff.map(s=>[s.id,s.name]));
 return <fieldset className="hq-staff-picker" disabled={disabled}><legend>{label}</legend>
 <div className="hq-selected-staff">{value.map(id=><Button type="button" variant="outline" key={id} aria-label={'Remove '+(names.get(id)||id)} onClick={()=>onChange(value.filter(v=>v!==id))}>{names.get(id)||id+' (inactive)'} ×</Button>)}{!value.length&&<span className="muted">No staff assigned</span>}</div>
 <Input type="search" aria-label={'Search '+label.toLowerCase()} placeholder="Find staff…" value={search} onChange={e=>setSearch(e.target.value)}/>
 <div className="hq-staff-options">{shown.map(s=><label key={s.id}><input type="checkbox" checked={value.includes(s.id)} onChange={e=>onChange(e.target.checked?[...value,s.id]:value.filter(id=>id!==s.id))}/>{s.name}</label>)}</div>{!shown.length&&<p role="status" className="hq-meta">No staff match “{search}”.</p>}
 </fieldset>;
}
