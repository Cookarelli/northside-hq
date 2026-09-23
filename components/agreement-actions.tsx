'use client';

import {useState} from 'react';
import {agreementNameError} from '@/lib/agreement-action';

type Props={
  agreementId:string;
  employeeName:string;
};

export function AgreementActions({agreementId,employeeName}:Props){
  const [fullName,setFullName]=useState('');
  const [accepted,setAccepted]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function acceptAgreement(){
    if(busy || !accepted) return;
    const nameError=agreementNameError(fullName,employeeName);
    if(nameError){setError(nameError);return;}
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/agreements',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'accept',agreementId,fullName})
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'Could not save your agreement.');
      if(!data.ok || !data.acceptedAt) throw new Error('Your signature was not confirmed. Please try again.');
      window.location.assign('/today');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }

  return <section className="panel agreement-actions">
    <h2>Signature required</h2>
    <p className="muted">Read the agreement above, type your name exactly as shown on your staff record, and accept it electronically to continue into Northside HQ. If the displayed name is incorrect, contact Steven before signing.</p>
    <label className="field"><span>Type your name exactly as shown: {employeeName}</span><input value={fullName} onChange={e=>{setFullName(e.target.value);setError('');}} autoComplete="name" aria-invalid={!!error} aria-describedby={error?'agreement-error':undefined}/></label>
    <label className="check-field"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>I have read and understand this agreement and agree to be bound by it. I consent to use my typed name and this electronic acceptance as my signature.</span></label>
    {error&&<p id="agreement-error" role="alert" className="notice error">{error}</p>}
    <div className="button-row">
      <button id="agreement-accept" type="button" disabled={busy||fullName.trim().length<2||!accepted} onClick={acceptAgreement}>{busy?'Saving…':'Accept & Sign'}</button>
    </div>
  </section>;
}
