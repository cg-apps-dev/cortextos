import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { isAdminSession } from '@/lib/account-switch';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!isAdminSession(session)) return Response.json({ error: 'Admin access required' }, { status: 403 });

  const headers = {
    origin: request.headers.get('origin'),
    referer: request.headers.get('referer'),
    host: request.headers.get('host'),
    'x-forwarded-host': request.headers.get('x-forwarded-host'),
    'x-forwarded-proto': request.headers.get('x-forwarded-proto'),
    'x-forwarded-for': request.headers.get('x-forwarded-for'),
    url: request.url,
    nextUrl_origin: request.nextUrl.origin,
  };

  console.log('[debug/request-headers]', headers);
  return Response.json(headers);
}
