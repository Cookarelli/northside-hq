'use client';
import {useId,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Command,CommandEmpty,CommandInput,CommandItem,CommandList} from '@/components/ui/command';

type Option={id:string;label:string};
export function ContentAssignmentPicker({label,value,options,disabled,onChange}:{label:string;value:string;options:Option[];disabled:boolean;onChange:(id:string)=>void}){
 const [open,setOpen]=useState(false),id=useId(),trigger=useRef<HTMLButtonElement>(null);
 const selected=options.find(option=>option.id===value)?.label;
 function close(){setOpen(false);trigger.current?.focus();}
 function choose(id:string){onChange(id);close();}
 return <div className="jon-picker"><span id={id+'-label'}>{label} <span className="hq-meta">(optional)</span></span>
  <Button ref={trigger} type="button" variant="outline" className="jon-picker-trigger" disabled={disabled} aria-labelledby={id+'-label '+id+'-value'} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)}><span id={id+'-value'}>{selected||(value?'Assignment unavailable':'Choose '+label.toLowerCase())}</span><ChevronDown size={16}/></Button>
  {open&&!disabled&&<Command id={id} className="jon-picker-options" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}>
   <CommandInput autoFocus aria-label={'Search '+label.toLowerCase()} placeholder={'Search '+label.toLowerCase()+'…'}/>
   <CommandList><CommandEmpty>No matching {label.toLowerCase()}.</CommandEmpty><CommandItem value={'No '+label.toLowerCase()} onSelect={()=>choose('')}>No {label.toLowerCase()}</CommandItem>{options.map(option=><CommandItem key={option.id} value={option.id+' '+option.label} onSelect={()=>choose(option.id)}>{option.label}</CommandItem>)}</CommandList>
  </Command>}
 </div>;
}
