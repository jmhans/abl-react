import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');

    if (!sessionCookie?.value) {
      return NextResponse.json({ user: null });
    }

    const session = JSON.parse(sessionCookie.value);
    return NextResponse.json({ user: session.user });
  } catch (error) {
    console.error('Session error:', error);
    return NextResponse.json({ user: null });
  }
}

export const dynamic = 'force-dynamic';