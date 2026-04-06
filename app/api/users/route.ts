import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSelectableCoOwnerUsers } from '@/app/lib/co-owner-users';

// GET /api/users
// Returns selectable users available for co-owner assignment.
// Auth required — only signed-in users can see the list.
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let callerId: string;
    try {
      callerId = JSON.parse(sessionCookie.value).user?.sub;
    } catch {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    if (!callerId) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const users = await getSelectableCoOwnerUsers();
    return NextResponse.json(users);
  } catch (error) {
    console.error('Error in /api/users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
