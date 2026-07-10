import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { createDashboardUser, deleteDashboardUser, listDashboardUsers } from '@/lib/user-admin';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  const result = listDashboardUsers(await auth());
  return Response.json(result.body, { status: result.status });
}

export async function POST(request: NextRequest) {
  const result = await createDashboardUser(request, await auth());
  return Response.json(result.body, { status: result.status });
}

export async function DELETE(request: NextRequest) {
  const result = await deleteDashboardUser(request, await auth());
  return Response.json(result.body, { status: result.status });
}
