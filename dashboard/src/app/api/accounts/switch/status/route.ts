import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { AccountSwitchHttpError, getSwitchJobStatus, isAdminSession } from '@/lib/account-switch';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!isAdminSession(session)) return Response.json({ error: 'Admin access required' }, { status: 403 });
  const jobId = request.nextUrl.searchParams.get('jobId') ?? '';
  try {
    return Response.json(getSwitchJobStatus(jobId));
  } catch (err) {
    if (err instanceof AccountSwitchHttpError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: 'Failed to read switch status' }, { status: 500 });
  }
}
