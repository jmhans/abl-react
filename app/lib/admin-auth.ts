import { cookies } from 'next/headers';

export interface SessionUser {
  sub?: string;
  email?: string;
  [key: string]: any;
}

const AUTH0_ROLES_CLAIM_NAMESPACE = process.env.AUTH0_ROLES_CLAIM_NAMESPACE || 'https://abl.app';
const AUTH0_ROLES_CLAIM_KEY = `${AUTH0_ROLES_CLAIM_NAMESPACE}/roles`;
const ADMIN_ROLE = 'ablAdmin';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function getUserRoles(user: SessionUser | null | undefined): string[] {
  if (!user) return [];

  const namespacedRoles = toStringArray(user[AUTH0_ROLES_CLAIM_KEY]);
  const standardRoles = toStringArray(user.roles);

  return Array.from(new Set([...namespacedRoles, ...standardRoles]));
}

export function isAdminUser(user: SessionUser | null | undefined): boolean {
  if (!user) return false;

  const roles = getUserRoles(user);
  return roles.includes(ADMIN_ROLE);
}

export async function getSessionUserFromCookies(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');

    if (!sessionCookie?.value) {
      return null;
    }

    const session = JSON.parse(sessionCookie.value);
    return session?.user || null;
  } catch {
    return null;
  }
}

export async function getAdminAuthState() {
  const user = await getSessionUserFromCookies();
  return {
    user,
    isAdmin: isAdminUser(user),
  };
}
