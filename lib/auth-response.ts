import { sessionClient } from '@/lib/supabase';
import { agreementGate } from '@/lib/agreements';
import { authCallbackDestination, postLoginDestination } from '@/lib/auth-routing';

export async function authResponse(request: Request, exchangeCode: boolean) {
  let destination = '/login?auth=unavailable';
  try {
    const client = await sessionClient(true);
    const gate = () => agreementGate(client);
    destination = exchangeCode
      ? await authCallbackDestination(client, new URL(request.url).searchParams, gate)
      : await postLoginDestination(client, gate);
  } catch {
    // Provider errors may contain credentials. Only show fixed, safe messages.
  }
  // Relative destinations preserve the host's PKCE/session cookies and do not
  // trust Host, X-Forwarded-Host, or an arbitrary next/redirectTo parameter.
  return new Response(null, { status: 303, headers: {
    Location: destination,
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  } });
}
