import { authResponse } from '@/lib/auth-response';

export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return authResponse(request, true);
}
