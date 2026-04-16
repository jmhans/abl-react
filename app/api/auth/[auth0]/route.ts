import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';
import { initUserProfileDisplayName, sanitizeDisplayName } from '@/app/lib/display-name';

const AUTH0_ROLES_CLAIM_NAMESPACE = process.env.AUTH0_ROLES_CLAIM_NAMESPACE || 'https://abl.app';
const AUTH0_ROLES_CLAIM_KEY = `${AUTH0_ROLES_CLAIM_NAMESPACE}/roles`;

function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) return null;

  try {
    const [, payload] = token.split('.');
    if (!payload) return null;

    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function extractRolesFromClaims(claims: Record<string, unknown> | null): string[] {
  if (!claims) return [];

  const namespacedRoles = toStringArray(claims[AUTH0_ROLES_CLAIM_KEY]);
  const standardRoles = toStringArray(claims.roles);

  return Array.from(new Set([...namespacedRoles, ...standardRoles]));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ auth0: string }> }
) {
  const { auth0: route } = await params;
  const url = new URL(request.url);

  // Dynamically compute base URL from request host (supports preview and production deployments)
  const origin = url.origin;

  if (route === 'login') {
    // Support ?returnTo=/some/path — encoded into OAuth state so it survives the redirect round-trip
    const returnTo = url.searchParams.get('returnTo') || '/';
    const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/';

    // If a valid session already exists, skip Auth0 and go directly to destination
    const cookieStore = await cookies();
    const existingSession = cookieStore.get('appSession');
    if (existingSession?.value) {
      try {
        const session = JSON.parse(existingSession.value);
        const now = Math.floor(Date.now() / 1000);
        // Use the session if it has no expiry (legacy) or has not yet expired
        if (!session.expires_at || session.expires_at > now) {
          return redirect(`${origin}${safeReturnTo}`);
        }
      } catch {
        // malformed cookie — fall through to Auth0
      }
    }

    const state = Buffer.from(JSON.stringify({ returnTo: safeReturnTo })).toString('base64url');

    const loginUrl = `${process.env.AUTH0_ISSUER_BASE_URL}/authorize?` +
      `response_type=code&` +
      `client_id=${process.env.AUTH0_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(`${origin}/api/auth/callback`)}&` +
      `scope=${encodeURIComponent('openid profile email offline_access')}&` +
      `state=${encodeURIComponent(state)}`;
    return redirect(loginUrl);
  }

  if (route === 'logout') {
    const response = NextResponse.redirect(
      `${process.env.AUTH0_ISSUER_BASE_URL}/v2/logout?` +
      `returnTo=${encodeURIComponent(origin || '')}&` +
      `client_id=${process.env.AUTH0_CLIENT_ID}`
    );
    response.cookies.delete('appSession');
    return response;
  }

  if (route === 'callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      return redirect('/?error=no_code');
    }

    try {
      const redirectUri = `${origin}/api/auth/callback`;

      // Exchange code for tokens using form-urlencoded
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.AUTH0_CLIENT_ID!,
        client_secret: process.env.AUTH0_CLIENT_SECRET!,
        code: code,
        redirect_uri: redirectUri,
      });

      const tokenResponse = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        console.error('Token exchange failed:', error);
        return redirect('/?error=token_failed');
      }

      const tokens = await tokenResponse.json();

      // Get user info
      const userResponse = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/userinfo`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userResponse.ok) {
        return redirect('/?error=userinfo_failed');
      }

      const user = await userResponse.json();
      const tokenClaims = decodeJwtPayload(tokens?.id_token);
      const roles = extractRolesFromClaims(tokenClaims);

      const sessionUser = {
        ...user,
        ...(tokenClaims && tokenClaims[AUTH0_ROLES_CLAIM_KEY]
          ? { [AUTH0_ROLES_CLAIM_KEY]: tokenClaims[AUTH0_ROLES_CLAIM_KEY] }
          : {}),
        roles,
      };

      // Keep an app-owned display name that can differ from provider profile data.
      // Use init (not upsert) so an existing custom display name is never overwritten on login.
      try {
        if (typeof sessionUser.sub === 'string' && sessionUser.sub) {
          const db = await connectToDatabase();
          const defaultName = sanitizeDisplayName(
            (sessionUser as any).name || (sessionUser as any).nickname || '',
            sessionUser.sub
          );
          await initUserProfileDisplayName(db, sessionUser.sub, defaultName);
        }
      } catch (profileError) {
        console.warn('Unable to initialize profile display name during callback:', profileError);
      }

      // Set session cookie
      // Decode state to find returnTo destination (from login ?returnTo= param)
      let redirectTo = origin;
      const stateParam = url.searchParams.get('state');
      if (stateParam) {
        try {
          const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
          if (typeof decoded.returnTo === 'string' && decoded.returnTo.startsWith('/')) {
            redirectTo = `${origin}${decoded.returnTo}`;
          }
        } catch {
          // malformed state — fall back to base URL
        }
      }

      const response = NextResponse.redirect(redirectTo);
      response.cookies.set('appSession', JSON.stringify({
        user: sessionUser,
        refresh_token: tokens.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 86400),
      }), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 90, // 90 days — kept alive by token refresh
      });

      return response;
    } catch (error) {
      console.error('Auth callback error:', error);
      return redirect('/?error=callback_failed');
    }
  }

  if (route === 'refresh') {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');

    if (!sessionCookie?.value) {
      return new Response('No session', { status: 401 });
    }

    let session: { user: unknown; refresh_token?: string; expires_at?: number };
    try {
      session = JSON.parse(sessionCookie.value);
    } catch {
      return new Response('Invalid session', { status: 401 });
    }

    if (!session.refresh_token) {
      return new Response('No refresh token', { status: 401 });
    }

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
        const err = await tokenResponse.text();
        console.error('Token refresh failed:', err);
        // Clear the stale session so the user is prompted to log in again
        const response = new Response('Refresh failed', { status: 401 });
        return response;
      }

      const tokens = await tokenResponse.json();

      const updatedSession = {
        ...session,
        refresh_token: tokens.refresh_token ?? session.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 86400),
      };

      const response = new Response('OK', { status: 200 });
      response.headers.set(
        'Set-Cookie',
        `appSession=${encodeURIComponent(JSON.stringify(updatedSession))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}`
      );
      return response;
    } catch (error) {
      console.error('Token refresh error:', error);
      return new Response('Refresh error', { status: 500 });
    }
  }

  return new Response('Not found', { status: 404 });
}

export const dynamic = 'force-dynamic';

