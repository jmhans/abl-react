import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ auth0: string }> }
) {
  const { auth0: route } = await params;
  const url = new URL(request.url);

  if (route === 'login') {
    const loginUrl = `${process.env.AUTH0_ISSUER_BASE_URL}/authorize?` +
      `response_type=code&` +
      `client_id=${process.env.AUTH0_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(`${process.env.AUTH0_BASE_URL}/api/auth/callback`)}&` +
      `scope=openid profile email`;
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
      // Exchange code for tokens using form-urlencoded
      const tokenResponse = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.AUTH0_CLIENT_ID!,
          client_secret: process.env.AUTH0_CLIENT_SECRET!,
          code: code,
          redirect_uri: `${process.env.AUTH0_BASE_URL}/api/auth/callback`,
        }),
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

      // Set session cookie
      const response = NextResponse.redirect(process.env.AUTH0_BASE_URL!);
      response.cookies.set('appSession', JSON.stringify({ user, tokens }), {
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

