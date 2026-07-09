import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { startSwitchJob } from '@/lib/account-switch';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await auth();
  const result = await startSwitchJob(request, session);
  return Response.json(result.body, { status: result.status });
}
