import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { upsertUserProfileDisplayName } from '@/app/lib/display-name';
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
// Body: { userId, selectable? , displayName? }
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
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (displayName) {
      if (displayName.length < 2 || displayName.length > 40) {
        return NextResponse.json(
          { error: 'Display name must be between 2 and 40 characters' },
          { status: 400 }
        );
      }

      const db = await connectToDatabase();
      const savedDisplayName = await upsertUserProfileDisplayName(db, userId, displayName);
      return NextResponse.json({ ok: true, displayName: savedDisplayName });
    }

    if (selectable === null) {
      return NextResponse.json({ error: 'Either selectable or displayName is required' }, { status: 400 });
    }

    await setCoOwnerUserSelectable(userId, selectable, user.sub);
    return NextResponse.json({ ok: true, selectable });
  } catch (error) {
    console.error('Error in PATCH /api/admin/co-owner-users:', error);
    return NextResponse.json({ error: 'Failed to update co-owner user selection' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
