import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { cancelSwitchQueueEntry } from '@/lib/account-switch-queue';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ queueId: string }> },
) {
  const session = await auth();
  const { queueId } = await params;
  const result = cancelSwitchQueueEntry(request, queueId, session);
  return Response.json(result.body, { status: result.status });
}
