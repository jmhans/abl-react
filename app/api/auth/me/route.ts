import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Read the session cookie
    const sessionCookie = request.cookies.get('appSession');
    
    if (!sessionCookie?.value) {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    
    // Parse the session data
    const session = JSON.parse(sessionCookie.value);
    
    return NextResponse.json({ user: session.user }, { status: 200 });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json({ user: null }, { status: 200 });
  }
}

export const dynamic = 'force-dynamic';