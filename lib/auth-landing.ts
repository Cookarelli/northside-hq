import {preparePasswordReset} from './password-recovery.ts';

type RecoveryAuth = Parameters<typeof preparePasswordReset>[0];

// Dashboard-issued recovery emails use URL fragments, which the server cannot
// read. Restore them before routing to HQ, using the existing recovery checks.
export async function authLandingDestination(href: string, clearLocation: () => void, getAuth: () => RecoveryAuth) {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.get('type') === 'recovery' || fragment.has('error') || fragment.has('error_code')) {
    try {
      await preparePasswordReset(getAuth(), href, clearLocation);
      return '/reset-password';
    } catch {
      clearLocation();
      return '/reset-password?error=invalid-link';
    }
  }
  clearLocation();
  return '/today';
}
