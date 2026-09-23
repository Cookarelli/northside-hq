export function agreementNameError(fullName: string, employeeName: string) {
  if (fullName.trim().toLowerCase() === employeeName.trim().toLowerCase() && fullName.trim().length >= 2) return '';
  return `Type your name exactly as shown: ${employeeName}. If this name is incorrect, contact Steven before signing.`;
}

// PostgREST returns plain objects, not Error instances. Only recognized errors
// become public messages; never return arbitrary database details to the client.
export function agreementActionError(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (message === 'Unauthorized') return {status:401,error:'Your sign-in has expired. Sign in again, then return to the agreement.'};
  if (message === 'Forbidden') return {status:403,error:'Your account could not submit this agreement. Refresh the page and try again, or contact Steven.'};
  if (code === '22023' && message === 'Type your full name exactly as shown.') {
    return {status:400,error:'Type your name exactly as shown above. If the displayed name is incorrect, contact Steven before signing.'};
  }
  if ((code === '22023' && message === 'Agreement must be provided before acceptance.') || (code === 'P0002' && message === 'Agreement unavailable.')) {
    return {status:409,error:'This agreement needs to be reloaded. Refresh the page, review it, and try again.'};
  }
  if (code === '55000' && message === 'Agreement version changed. Contact your administrator.') {
    return {status:409,error:'The agreement version changed. Contact Steven before signing.'};
  }
  if (error instanceof SyntaxError) return {status:400,error:'Invalid agreement request. Refresh the page and try again.'};
  return {status:503,error:'Your agreement could not be saved right now. Please try again. Access remains locked until your signature is saved.'};
}
