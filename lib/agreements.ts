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

export async function agreementGate(client?: Awaited<ReturnType<typeof sessionClient>>): Promise<AgreementGate> {
  client ??= await sessionClient();
  const {data,error}=await client.rpc('hub_agreement_gate');
  if(error) throw new Error('Agreement verification is unavailable. Please contact your administrator.');
  if(!data || typeof data.required!=='boolean' || (data.required && (!data.agreementId || !data.storagePath || data.hardGate!==true))) {
    throw new Error('Agreement verification returned incomplete information. Access remains locked.');
  }
  return data as AgreementGate;
}

export async function agreementSignedUrl(path:string) {
  const client=await sessionClient();
  const {data,error}=await client.storage.from('employee-agreements').createSignedUrl(path,60*10);
  if(error) throw error;
  return data.signedUrl;
}
