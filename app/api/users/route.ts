import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';

// GET /api/users
// Returns all users available for co-owner assignment.
// Primary source: Auth0 Management API (all authorized users).
// Fallback/merge source: unique owners seen in ablteams collection.
// Auth required — only signed-in users can see the list.

type CoOwnerUser = {
  userId: string;
  name: string;
};

function normalizeUser(user: Partial<CoOwnerUser>): CoOwnerUser | null {
  const userId = (user.userId || '').trim();
  if (!userId) return null;

  return {
    userId,
    name: (user.name || '').trim() || userId,
  };
}

async function fetchUsersFromAuth0Management(): Promise<CoOwnerUser[]> {
  const issuerBaseUrl = process.env.AUTH0_ISSUER_BASE_URL;
  const managementClientId = process.env.AUTH0_M2M_CLIENT_ID;
  const managementClientSecret = process.env.AUTH0_M2M_CLIENT_SECRET;

  if (!issuerBaseUrl || !managementClientId || !managementClientSecret) {
    // Dedicated M2M credentials are optional in local/dev. If not set, caller can fall back.
    return [];
  }

  const audience = process.env.AUTH0_MANAGEMENT_API_AUDIENCE || `${issuerBaseUrl}/api/v2/`;
  const tokenRes = await fetch(`${issuerBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: managementClientId,
      client_secret: managementClientSecret,
      audience,
    }),
    cache: 'no-store',
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    throw new Error(`Auth0 token request failed (${tokenRes.status}): ${body}`);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData?.access_token as string | undefined;
  if (!accessToken) {
    throw new Error('Auth0 token response did not include access_token');
  }

  const users: CoOwnerUser[] = [];
  const perPage = 100;
  const maxPages = 10; // up to 1,000 users

  for (let page = 0; page < maxPages; page += 1) {
    const usersRes = await fetch(
      `${issuerBaseUrl}/api/v2/users?per_page=${perPage}&page=${page}&include_totals=false`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      }
    );

    if (!usersRes.ok) {
      const body = await usersRes.text().catch(() => '');
      throw new Error(`Auth0 users request failed (${usersRes.status}): ${body}`);
    }

    const pageUsers = (await usersRes.json()) as Array<any>;
    if (!Array.isArray(pageUsers) || pageUsers.length === 0) break;

    for (const user of pageUsers) {
      const normalized = normalizeUser({
        userId: user?.user_id,
        name: user?.name || user?.nickname,
      });
      if (normalized) users.push(normalized);
    }

    if (pageUsers.length < perPage) break;
  }

  return users;
}

async function fetchUsersFromTeamOwners(): Promise<CoOwnerUser[]> {
  const db = await connectToDatabase();

  const users = await db.collection('ablteams').aggregate([
    { $unwind: '$owners' },
    { $replaceRoot: { newRoot: '$owners' } },
    {
      $group: {
        _id: '$userId',
        userId: { $first: '$userId' },
        name: { $first: '$name' },
      },
    },
    { $project: { _id: 0, userId: 1, name: 1 } },
  ]).toArray();

  return users
    .map((u: any) => normalizeUser({ userId: u.userId, name: u.name }))
    .filter((u: CoOwnerUser | null): u is CoOwnerUser => u !== null);
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let callerId: string;
    try {
      callerId = JSON.parse(sessionCookie.value).user?.sub;
    } catch {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    if (!callerId) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const [auth0UsersResult, teamUsersResult] = await Promise.allSettled([
      fetchUsersFromAuth0Management(),
      fetchUsersFromTeamOwners(),
    ]);

    const auth0Users = auth0UsersResult.status === 'fulfilled' ? auth0UsersResult.value : [];
    const teamUsers = teamUsersResult.status === 'fulfilled' ? teamUsersResult.value : [];

    if (auth0UsersResult.status === 'rejected') {
      const reasonText = String(auth0UsersResult.reason || '');
      if (reasonText.includes('unauthorized_client')) {
        console.warn('Auth0 Management API not enabled for configured M2M client; falling back to team-owner users.');
      } else {
        console.error('Auth0 Management users fetch failed:', auth0UsersResult.reason);
      }
    }

    if (teamUsersResult.status === 'rejected') {
      console.error('Team owners users fallback fetch failed:', teamUsersResult.reason);
    }

    const merged = new Map<string, CoOwnerUser>();

    for (const user of [...teamUsers, ...auth0Users]) {
      if (!merged.has(user.userId)) {
        merged.set(user.userId, user);
      }
    }

    const users = Array.from(merged.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error in /api/users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
