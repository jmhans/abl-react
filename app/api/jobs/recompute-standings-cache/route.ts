import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { refreshStandingsCache } from '@/app/lib/standings-service';

// GET/POST /api/jobs/recompute-standings-cache
// Safety-net refresh for standings_cache, in case a game's calculate-results call
// didn't trigger refreshStandingsCacheForGame (e.g. manual DB edits, backfills).
// Scheduled daily in vercel.json; the primary freshness path is the per-game hook.
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const { isAdmin } = await getAdminAuthState();
  if (isAdmin) return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
  const headerSecret = request.headers.get('x-cron-secret') || '';

  return token === secret || headerSecret === secret;
}

async function handleRecompute(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = await connectToDatabase();
  const seasons = await db.collection('seasons').find({}).toArray();
  const leagues = await db.collection('leagues').find({}).toArray();
  const leagueById = new Map(leagues.map((l) => [l._id.toString(), l]));

  const results: { league: string; season: string; ok: boolean; teams?: number; error?: string }[] = [];

  for (const season of seasons) {
    const league = leagueById.get(season.leagueId?.toString());
    if (!league?.slug || !season?.slug) continue;

    try {
      const { standings } = await refreshStandingsCache(db, league.slug, season.slug);
      results.push({ league: league.slug, season: season.slug, ok: true, teams: standings.length });
    } catch (error) {
      results.push({
        league: league.slug,
        season: season.slug,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({ ok: true, refreshed: results });
}

export async function GET(request: NextRequest) {
  return handleRecompute(request);
}

export async function POST(request: NextRequest) {
  return handleRecompute(request);
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
