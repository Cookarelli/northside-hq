import Link from 'next/link';
import {SignOut} from '@/components/sign-out';

export function AgreementUnavailable() {
  return <main className="agreement-shell"><section className="panel">
    <p className="brand-word">NORTHSIDE HQ</p><h1>Agreement verification required</h1>
    <p>Your workspace stays locked until the required agreement can be verified.</p>
    <p className="muted">If the agreement has not been provided yet, contact your administrator. If this is a connection issue, try again.</p>
    <div className="button-row"><Link href="/agreements/required">Try again</Link><SignOut/></div>
  </section></main>;
}
