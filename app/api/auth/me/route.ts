import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getUserProfileDisplayName, sanitizeDisplayName } from '@/app/lib/display-name';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');

    if (!sessionCookie?.value) {
      return NextResponse.json({ user: null });
    }

    const session = JSON.parse(sessionCookie.value);
    const sessionUser = session?.user;

    if (!sessionUser?.sub) {
      return NextResponse.json({ user: null });
    }

    let displayName = sanitizeDisplayName(sessionUser.name || sessionUser.nickname || '', sessionUser.sub);
    try {
      const db = await connectToDatabase();
      const savedDisplayName = await getUserProfileDisplayName(db, sessionUser.sub);
      if (savedDisplayName) {
        displayName = savedDisplayName;
      }
    } catch (profileError) {
      console.warn('Profile name lookup failed in /api/auth/me:', profileError);
    }

    return NextResponse.json({
      user: {
        ...sessionUser,
        name: displayName,
      },
    });
  } catch (error) {
    console.error('Session error:', error);
    return NextResponse.json({ user: null });
  }
}

export const dynamic = 'force-dynamic';