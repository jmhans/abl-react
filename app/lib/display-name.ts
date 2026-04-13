import { Db } from 'mongodb';

type UserProfileDoc = {
  userId: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
};

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function isLikelyEmail(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function fallbackDisplayNameFromUserId(userId: string): string {
  const idPart = userId.includes('|') ? userId.split('|').pop() || userId : userId;
  const suffix = idPart.slice(-4).toUpperCase();
  return suffix ? `ABL User ${suffix}` : 'ABL User';
}

export function sanitizeDisplayName(input: string | undefined | null, userId: string): string {
  const normalized = compactWhitespace(input || '');
  if (!normalized || isLikelyEmail(normalized)) {
    return fallbackDisplayNameFromUserId(userId);
  }
  return normalized.slice(0, 40);
}

export async function getUserProfileDisplayName(db: Db, userId: string): Promise<string | null> {
  const profile = await db.collection<UserProfileDoc>('user_profiles').findOne(
    { userId },
    { projection: { _id: 0, displayName: 1 } }
  );

  if (!profile?.displayName) return null;
  return sanitizeDisplayName(profile.displayName, userId);
}

export async function getDisplayNameMap(db: Db, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const profiles = await db
    .collection<UserProfileDoc>('user_profiles')
    .find({ userId: { $in: userIds } }, { projection: { _id: 0, userId: 1, displayName: 1 } })
    .toArray();

  const map = new Map<string, string>();
  for (const profile of profiles) {
    if (!profile?.userId || !profile?.displayName) continue;
    map.set(profile.userId, sanitizeDisplayName(profile.displayName, profile.userId));
  }

  return map;
}

export async function upsertUserProfileDisplayName(db: Db, userId: string, displayName: string): Promise<string> {
  const sanitized = sanitizeDisplayName(displayName, userId);
  const now = new Date();

  await db.collection<UserProfileDoc>('user_profiles').updateOne(
    { userId },
    {
      $set: {
        userId,
        displayName: sanitized,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return sanitized;
}

/**
 * Initializes the display name for a user profile only on first creation.
 * If a profile already exists (e.g. user has set a custom display name),
 * the existing display name is preserved.
 */
export async function initUserProfileDisplayName(db: Db, userId: string, displayName: string): Promise<void> {
  const sanitized = sanitizeDisplayName(displayName, userId);
  const now = new Date();

  await db.collection<UserProfileDoc>('user_profiles').updateOne(
    { userId },
    {
      $setOnInsert: {
        userId,
        displayName: sanitized,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}