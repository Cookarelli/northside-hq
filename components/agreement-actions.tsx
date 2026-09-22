'use client';

import {useState} from 'react';

type Props={
  agreementId:string;
  employeeName:string;
  hardGate:boolean;
  reviewDueAt:string;
};

export function AgreementActions({agreementId,employeeName,hardGate,reviewDueAt}:Props){
  const [fullName,setFullName]=useState('');
  const [busy,setBusy]=useState(false);
  const [accepted,setAccepted]=useState(false);
  const [error,setError]=useState('');

  async function act(action:'accept'|'defer'){
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/agreements',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(action==='accept'?{action,agreementId,fullName}:{action,agreementId})
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'Could not save your response.');
      window.location.assign('/today');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }

  return <section className="panel agreement-actions">
    <h2>{hardGate?'Acceptance required':'Your review period is open'}</h2>
    <p className="muted">{hardGate
      ? 'The review period has ended. Accept the agreement to continue into Northside HQ.'
      : `You may sign now voluntarily, or continue to HQ and review it through ${new Date(reviewDueAt).toLocaleDateString('en-US',{timeZone:'America/Chicago',month:'long',day:'numeric',year:'numeric'})}.`}</p>
    <label className="field"><span>Type your full name exactly as shown: {employeeName}</span><input value={fullName} onChange={e=>setFullName(e.target.value)} autoComplete="name"/></label>
    <label className="check-field"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>I have read and understand this agreement and choose to accept it electronically.</span></label>
    {error&&<p role="alert" className="notice error">{error}</p>}
    <div className="button-row">
      <button id="agreement-accept" type="button" disabled={busy||fullName.trim().length<2||!accepted} onClick={()=>act('accept')}>{busy?'Saving…':'Accept & Sign'}</button>
      {!hardGate&&<button type="button" className="secondary-action" disabled={busy} onClick={()=>act('defer')}>Continue during review period</button>}
    </div>
  </section>;
}
