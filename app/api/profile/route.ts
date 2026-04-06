import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import {
  getUserProfileDisplayName,
  sanitizeDisplayName,
  upsertUserProfileDisplayName,
} from '@/app/lib/display-name';

type SessionUser = {
  sub: string;
  name?: string;
  nickname?: string;
};

async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('appSession');
  if (!sessionCookie?.value) return null;

  try {
    const session = JSON.parse(sessionCookie.value);
    const user = session?.user as SessionUser | undefined;
    if (!user?.sub) return null;
    return user;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const db = await connectToDatabase();
    const saved = await getUserProfileDisplayName(db, sessionUser.sub);
    const currentDisplayName =
      saved || sanitizeDisplayName(sessionUser.name || sessionUser.nickname || '', sessionUser.sub);

    return NextResponse.json({
      userId: sessionUser.sub,
      displayName: currentDisplayName,
      isCustom: Boolean(saved),
    });
  } catch (error) {
    console.error('Error in GET /api/profile:', error);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const rawDisplayName = typeof body?.displayName === 'string' ? body.displayName : '';
    const trimmed = rawDisplayName.trim();

    if (trimmed.length < 2 || trimmed.length > 40) {
      return NextResponse.json(
        { error: 'Display name must be between 2 and 40 characters' },
        { status: 400 }
      );
    }

    const db = await connectToDatabase();
    const displayName = await upsertUserProfileDisplayName(db, sessionUser.sub, trimmed);

    return NextResponse.json({ ok: true, displayName });
  } catch (error) {
    console.error('Error in PATCH /api/profile:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';