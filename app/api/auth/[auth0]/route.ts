import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';

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

  if (route === 'login') {
    // Support ?returnTo=/some/path — encoded into OAuth state so it survives the redirect round-trip
    const returnTo = url.searchParams.get('returnTo') || '/';
    const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/';
    const state = Buffer.from(JSON.stringify({ returnTo: safeReturnTo })).toString('base64url');

    const loginUrl = `${process.env.AUTH0_ISSUER_BASE_URL}/authorize?` +
      `response_type=code&` +
      `client_id=${process.env.AUTH0_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(`${process.env.AUTH0_BASE_URL}/api/auth/callback`)}&` +
      `scope=openid profile email&` +
      `state=${encodeURIComponent(state)}`;
    return redirect(loginUrl);
  }

  if (route === 'logout') {
    const response = NextResponse.redirect(
      `${process.env.AUTH0_ISSUER_BASE_URL}/v2/logout?` +
      `returnTo=${encodeURIComponent(process.env.AUTH0_BASE_URL || '')}&` +
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
      const redirectUri = `${process.env.AUTH0_BASE_URL}/api/auth/callback`;

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

      // Set session cookie
      // Decode state to find returnTo destination (from login ?returnTo= param)
      let redirectTo = process.env.AUTH0_BASE_URL!;
      const stateParam = url.searchParams.get('state');
      if (stateParam) {
        try {
          const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
          if (typeof decoded.returnTo === 'string' && decoded.returnTo.startsWith('/')) {
            redirectTo = `${process.env.AUTH0_BASE_URL}${decoded.returnTo}`;
          }
        } catch {
          // malformed state — fall back to base URL
        }
      }

      const response = NextResponse.redirect(redirectTo);
      response.cookies.set('appSession', JSON.stringify({ user: sessionUser }), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });

      return response;
    } catch (error) {
      console.error('Auth callback error:', error);
      return redirect('/?error=callback_failed');
    }
  }

  return new Response('Not found', { status: 404 });
}

export const dynamic = 'force-dynamic';

