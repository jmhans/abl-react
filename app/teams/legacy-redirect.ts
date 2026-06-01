import { headers } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

function inferLeagueFromReferrer(): string | null {
  const referer = headers().get('referer');
  if (!referer) return null;
  try {
    const pathname = new URL(referer).pathname;
    const m = pathname.match(/^\/([^/]+)\/\d{4}(?:\/|$)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function resolveLegacyLeagueSeason(preferredLeague?: string | null) {
  const db = await connectToDatabase();
  const requestedLeague = (preferredLeague ?? inferLeagueFromReferrer() ?? 'abl').toLowerCase();

  try {
    const { league, season } = await resolveLeagueContext(db, requestedLeague, 'active');
    return { leagueSlug: league.slug, seasonYear: String(season.year) };
  } catch {
    const { league, season } = await resolveLeagueContext(db, 'abl', 'active');
    return { leagueSlug: league.slug, seasonYear: String(season.year) };
  }
}
