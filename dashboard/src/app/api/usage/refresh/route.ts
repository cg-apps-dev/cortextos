import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { refreshUsageSnapshot } from '@/lib/usage-refresh';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await auth();
  const result = await refreshUsageSnapshot(request, session);
  return Response.json(result.body, { status: result.status });
}
