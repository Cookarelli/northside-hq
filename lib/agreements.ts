import {sessionClient} from '@/lib/supabase';

export type AgreementGate = {
  required: boolean;
  agreementId?: string;
  title?: string;
  version?: string;
  storagePath?: string;
  documentHash?: string;
  effectiveDate?: string;
  employeeName?: string;
  employeeEmail?: string;
  employeeTitle?: string;
  providedAt?: string;
  reviewDueAt?: string;
  hardGate?: boolean;
};

export async function agreementGate(): Promise<AgreementGate> {
  const client=await sessionClient();
  const {data,error}=await client.rpc('hub_agreement_gate');
  // Keep HQ usable while the agreement migration is being deployed. Once the
  // RPC exists, any real database/auth error still fails closed.
  if(error){
    const code=String((error as {code?:string}).code||'');
    const message=String((error as {message?:string}).message||'');
    if(code==='PGRST202'||code==='42883'||/hub_agreement_gate/i.test(message)&&/not found|does not exist/i.test(message)){
      return {required:false};
    }
    throw error;
  }
  return (data || {required:false}) as AgreementGate;
}

export async function agreementSignedUrl(path:string) {
  const client=await sessionClient();
  const {data,error}=await client.storage.from('employee-agreements').createSignedUrl(path,60*10);
  if(error) throw error;
  return data.signedUrl;
}
