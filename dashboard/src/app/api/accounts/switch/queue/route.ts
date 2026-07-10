import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { enqueueSwitchRequest, getSwitchQueueStatus } from '@/lib/account-switch-queue';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await auth();
  const result = await enqueueSwitchRequest(request, session);
  return Response.json(result.body, { status: result.status });
}

export async function GET() {
  const session = await auth();
  const result = getSwitchQueueStatus(session);
  return Response.json(result.body, { status: result.status });
}
