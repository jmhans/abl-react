import { Db } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getDisplayNameMap, sanitizeDisplayName } from '@/app/lib/display-name';

export type CoOwnerUser = {
  userId: string;
  name: string;
};

type CoOwnerMergedUser = CoOwnerUser & {
  rawName?: string;
  email?: string;
};

export type CoOwnerAdminUser = CoOwnerUser & {
  selectable: boolean;
  rawName?: string;
  email?: string;
};

type SelectionOverrideDoc = {
  userId: string;
  selectable: boolean;
  updatedAt: Date;
  updatedBy?: string;
};

function normalizeUser(user: Partial<CoOwnerUser>): CoOwnerUser | null {
  const userId = (user.userId || '').trim();
  if (!userId) return null;

  return {
    userId,
    name: sanitizeDisplayName(user.name || '', userId),
  };
}

function normalizeMergedUser(user: Partial<CoOwnerMergedUser>): CoOwnerMergedUser | null {
  const normalized = normalizeUser(user);
  if (!normalized) return null;

  const rawName = typeof user.rawName === 'string' ? user.rawName.trim() : '';
  const email = typeof user.email === 'string' ? user.email.trim() : '';

  return {
    ...normalized,
    ...(rawName ? { rawName: rawName.slice(0, 120) } : {}),
    ...(email ? { email: email.slice(0, 160) } : {}),
  };
}

async function fetchUsersFromAuth0Management(): Promise<CoOwnerMergedUser[]> {
  const issuerBaseUrl = process.env.AUTH0_ISSUER_BASE_URL;
  const managementClientId = process.env.AUTH0_M2M_CLIENT_ID;
  const managementClientSecret = process.env.AUTH0_M2M_CLIENT_SECRET;

  if (!issuerBaseUrl || !managementClientId || !managementClientSecret) {
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

  const users: CoOwnerMergedUser[] = [];
  const perPage = 100;
  const maxPages = 10;

  for (let page = 0; page < maxPages; page += 1) {
    const usersRes = await fetch(
      `${issuerBaseUrl}/api/v2/users?per_page=${perPage}&page=${page}&include_totals=false`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
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
      const normalized = normalizeMergedUser({
        userId: user?.user_id,
        name: user?.name || user?.nickname,
        rawName: user?.name || user?.nickname,
        email: user?.email,
      });
      if (normalized) users.push(normalized);
    }

    if (pageUsers.length < perPage) break;
  }

  return users;
}

async function fetchUsersFromTeamOwners(db: Db): Promise<CoOwnerMergedUser[]> {
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
    .map((u: any) => normalizeMergedUser({ userId: u.userId, name: u.name, rawName: u.name }))
    .filter((u: CoOwnerMergedUser | null): u is CoOwnerMergedUser => u !== null);
}

async function getDeselectedUserIdSet(db: Db): Promise<Set<string>> {
  const records = await db
    .collection<SelectionOverrideDoc>('coowner_user_overrides')
    .find({ selectable: false }, { projection: { _id: 0, userId: 1 } })
    .toArray();

  return new Set(records.map((r) => r.userId).filter(Boolean));
}

async function getAuthorizedAblUserIdSet(db: Db): Promise<Set<string>> {
  const profiles = await db
    .collection<{ userId: string }>('user_profiles')
    .find({}, { projection: { _id: 0, userId: 1 } })
    .toArray();

  return new Set(profiles.map((p) => p.userId).filter(Boolean));
}

async function getMergedUsers(db: Db): Promise<CoOwnerMergedUser[]> {
  const authorizedUserIds = await getAuthorizedAblUserIdSet(db);
  const [auth0UsersResult, teamUsersResult] = await Promise.allSettled([
    fetchUsersFromAuth0Management(),
    fetchUsersFromTeamOwners(db),
  ]);

  const auth0Users = auth0UsersResult.status === 'fulfilled'
    ? auth0UsersResult.value.filter((u) => authorizedUserIds.has(u.userId))
    : [];
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

  const merged = new Map<string, CoOwnerMergedUser>();
  for (const user of [...teamUsers, ...auth0Users]) {
    if (!merged.has(user.userId)) {
      merged.set(user.userId, user);
    }
  }

  const profileNameMap = await getDisplayNameMap(db, Array.from(merged.keys()));
  for (const [userId, user] of merged.entries()) {
    const profileName = profileNameMap.get(userId);
    if (profileName) {
      merged.set(userId, { ...user, name: profileName });
    }
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

export async function getSelectableCoOwnerUsers(): Promise<CoOwnerUser[]> {
  const db = await connectToDatabase();
  const [users, deselectedSet] = await Promise.all([
    getMergedUsers(db),
    getDeselectedUserIdSet(db),
  ]);

  return users
    .filter((u) => !deselectedSet.has(u.userId))
    .map(({ userId, name }) => ({ userId, name }));
}

export async function getAdminCoOwnerUsers(): Promise<CoOwnerAdminUser[]> {
  const db = await connectToDatabase();
  const [users, deselectedSet] = await Promise.all([
    getMergedUsers(db),
    getDeselectedUserIdSet(db),
  ]);

  return users.map((u) => ({
    ...u,
    selectable: !deselectedSet.has(u.userId),
  }));
}

export async function setCoOwnerUserSelectable(userId: string, selectable: boolean, updatedBy?: string) {
  const normalizedUserId = (userId || '').trim();
  if (!normalizedUserId) {
    throw new Error('userId is required');
  }

  const db = await connectToDatabase();
  const collection = db.collection<SelectionOverrideDoc>('coowner_user_overrides');

  if (selectable) {
    await collection.deleteOne({ userId: normalizedUserId });
    return;
  }

  await collection.updateOne(
    { userId: normalizedUserId },
    {
      $set: {
        userId: normalizedUserId,
        selectable: false,
        updatedAt: new Date(),
        ...(updatedBy ? { updatedBy } : {}),
      },
    },
    { upsert: true }
  );
}