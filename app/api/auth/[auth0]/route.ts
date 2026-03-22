import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';

export async function GET(request: Request, { params }: { params: Promise<{ auth0: string }> }) {
  const { auth0: route } = await params;
  const url = new URL(request.url);
  const baseUrl = process.env.AUTH0_BASE_URL || '';
  
  // Debug logging
  if (!process.env.AUTH0_BASE_URL) {
    console.error('AUTH0_BASE_URL is not set!');
  }
  
  if (route === 'login') {
    // Redirect to Auth0 login
    const loginUrl = `${process.env.AUTH0_ISSUER_BASE_URL}/authorize?` +
      `response_type=code&` +
      `client_id=${process.env.AUTH0_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(baseUrl + '/api/auth/callback')}&` +
      `scope=openid profile email`;
    
    return redirect(loginUrl);
  }
  
  if (route === 'logout') {
    // Handle logout by clearing session and redirecting to Auth0 logout
    const response = NextResponse.redirect(`${process.env.AUTH0_ISSUER_BASE_URL}/logout?` +
      `returnTo=${encodeURIComponent(baseUrl)}&` +
      `client_id=${process.env.AUTH0_CLIENT_ID}`);
    
    // Clear the session cookie
    response.cookies.set('appSession', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0
    });
    return response;
  }
  
  if (route === 'callback') {
    // Handle the callback by exchanging code for tokens
    const code = url.searchParams.get('code');
    if (!code) {
      return redirect('/');
    }
    
    try {
      // Exchange code for tokens
      const redirectUri = `${baseUrl}/api/auth/callback`;
      console.log('Token exchange - redirect_uri:', redirectUri);
      
      const tokenResponse = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: process.env.AUTH0_CLIENT_ID,
          client_secret: process.env.AUTH0_CLIENT_SECRET,
          code: code,
          redirect_uri: redirectUri
        })
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed:', tokenResponse.status, errorText);
        throw new Error(`Token exchange failed: ${tokenResponse.status} - ${errorText}`);
      }
      
      const tokens = await tokenResponse.json();
      
      // Create session with user info
      const userResponse = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/userinfo`, {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` }
      });
      
      if (userResponse.ok) {
        const user = await userResponse.json();
        
        // Create response with session cookie
        const response = NextResponse.redirect(baseUrl + '/');
        response.cookies.set('appSession', JSON.stringify({ user, tokens }), {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 7 // 7 days
        });
        
        return response;
      }
      
      const errorText = await userResponse.text();
      console.error('Failed to get user info:', userResponse.status, errorText);
      throw new Error(`Failed to get user info: ${userResponse.status}`);
      
    } catch (error) {
      console.error('Auth callback error:', error);
      return redirect('/?error=callback_failed');
    }
  }
  
  // Default fallback
  return new Response('Not found', { status: 404 });
}

export const dynamic = 'force-dynamic';

