import { NextResponse } from 'next/server';
import { getAdminAuthState } from '@/app/lib/admin-auth';

export async function GET() {
  const { user, isAdmin } = await getAdminAuthState();
  return NextResponse.json({ user, isAdmin });
}

export const dynamic = 'force-dynamic';
