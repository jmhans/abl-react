import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { getAdminCoOwnerUsers, setCoOwnerUserSelectable } from '@/app/lib/co-owner-users';

// GET /api/admin/co-owner-users
// Admin-only endpoint to review/toggle users available in add co-owner workflow.
export async function GET() {
  try {
    const { user, isAdmin } = await getAdminAuthState();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const users = await getAdminCoOwnerUsers();
    return NextResponse.json(users);
  } catch (error) {
    console.error('Error in GET /api/admin/co-owner-users:', error);
    return NextResponse.json({ error: 'Failed to fetch co-owner users' }, { status: 500 });
  }
}

// PATCH /api/admin/co-owner-users
// Body: { userId, selectable }
export async function PATCH(request: NextRequest) {
  try {
    const { user, isAdmin } = await getAdminAuthState();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    const selectable = typeof body?.selectable === 'boolean' ? body.selectable : null;

    if (!userId || selectable === null) {
      return NextResponse.json({ error: 'userId and selectable are required' }, { status: 400 });
    }

    await setCoOwnerUserSelectable(userId, selectable, user.sub);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in PATCH /api/admin/co-owner-users:', error);
    return NextResponse.json({ error: 'Failed to update co-owner user selection' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
