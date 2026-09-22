'use client';
import {useState,type ComponentProps} from 'react';

export function PasswordField({id,...props}:Omit<ComponentProps<'input'>,'type'> & {id:string}) {
  const [visible,setVisible]=useState(false);
  return <div className="password-field">
    <input {...props} id={id} type={visible?'text':'password'}/>
    <button type="button" className="password-visibility" aria-controls={id} aria-pressed={visible} onClick={()=>setVisible(value=>!value)}>{visible?'Hide password':'Show password'}</button>
  </div>;
}
