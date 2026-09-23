import {AgreementUnavailable} from '@/components/agreement-unavailable';
import {redirect} from 'next/navigation';
import {agreementGate,agreementSignedUrl} from '@/lib/agreements';
import {identity} from '@/lib/storage';
import {AgreementActions} from '@/components/agreement-actions';
import {ThemeToggle} from '@/components/theme-provider';

export const dynamic='force-dynamic';

export default async function RequiredAgreement(){
  try{await identity();}catch{redirect('/login');}
  let gate;
  try {gate=await agreementGate();} catch {return <AgreementUnavailable/>;}
  if(!gate.required||!gate.agreementId||!gate.storagePath) redirect('/today');
  let signedUrl;
  try {signedUrl=await agreementSignedUrl(gate.storagePath);} catch {
    console.error('Required agreement PDF is unavailable in private storage.');
    return <AgreementUnavailable/>;
  }

  return <><div className="appearance-bar"><ThemeToggle/></div><main className="agreement-shell">
    <section className="panel agreement-heading">
      <p className="brand-word">NORTHSIDE HQ</p>
      <p className="eyebrow">EMPLOYMENT AGREEMENT</p>
      <h1>{gate.title}</h1>
      <div className="agreement-meta">
        <span><b>Employee</b>{gate.employeeName}</span>
        <span><b>Email</b>{gate.employeeEmail}</span>
        <span><b>Position</b>{gate.employeeTitle||'Northside staff'}</span>
        <span><b>Version</b>{gate.version}</span>
        <span><b>Date provided</b>{new Date(gate.providedAt!).toLocaleDateString('en-US',{timeZone:'America/Chicago'})}</span>
      </div>
      <p className="muted">Review the controlled PDF below. Your electronic signature is tied to this exact document version and document hash.</p>
    </section>
    <section className="panel agreement-document">
      <div className="section-title"><h2>Agreement document</h2><a href={signedUrl} target="_blank" rel="noreferrer">Open full PDF</a></div>
      <iframe title={gate.title} src={signedUrl}/>
    </section>
    <AgreementActions agreementId={gate.agreementId} employeeName={gate.employeeName||''}/>
  </main></>;
}
