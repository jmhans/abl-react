import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// How many seconds before expiry to proactively refresh the access token
const REFRESH_THRESHOLD_SECONDS = 5 * 60; // 5 minutes

export async function proxy(request: NextRequest) {
  const sessionCookie = request.cookies.get('appSession');

  if (!sessionCookie?.value) {
    return NextResponse.next();
  }

  let session: { user: unknown; refresh_token?: string; expires_at?: number };
  try {
    session = JSON.parse(sessionCookie.value);
  } catch {
    return NextResponse.next();
  }

  // No expiry info stored (legacy session) or no refresh token — nothing to do
  if (!session.expires_at || !session.refresh_token) {
    return NextResponse.next();
  }

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - now > REFRESH_THRESHOLD_SECONDS) {
    // Token is still valid and not close to expiry
    return NextResponse.next();
  }

  // Token has expired or is about to — silently refresh using the stored refresh token
  try {
    const refreshParams = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.AUTH0_CLIENT_ID!,
      client_secret: process.env.AUTH0_CLIENT_SECRET!,
      refresh_token: session.refresh_token,
    });

    const tokenResponse = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshParams,
    });

    if (!tokenResponse.ok) {
      // Refresh failed — clear the stale session so the user is asked to log in again
      const response = NextResponse.next();
      response.cookies.delete('appSession');
      return response;
    }

    const tokens = await tokenResponse.json();

    const updatedSession = {
      ...session,
      refresh_token: tokens.refresh_token ?? session.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 86400),
    };

    const response = NextResponse.next();
    response.cookies.set('appSession', JSON.stringify(updatedSession), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 90, // 90 days
    });
    return response;
  } catch {
    // Network or parse error — leave the session untouched and let the request proceed
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static assets
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?|ttf)).*)',
  ],
};
