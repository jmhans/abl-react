import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { runSimulation } from '@/app/lib/simulate-standings';

function getSnapshotDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const { isAdmin } = await getAdminAuthState();
  if (isAdmin) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return token === secret || request.headers.get('x-cron-secret') === secret;
}

/** GET /api/jobs/simulate-standings
 *  Nightly cron: runs simulation for every active season across all leagues.
 *  numScenarios controlled by SIMULATE_STANDINGS_SCENARIOS env var (default 1000).
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const numScenarios = Math.max(
    1,
    parseInt(process.env.SIMULATE_STANDINGS_SCENARIOS ?? '10000', 10),
  );

  try {
    const db = await connectToDatabase();

    // Find all active seasons
    const activeSeasons = await db.collection('seasons').find({ isActive: true }).toArray();

    const results: { league: string; season: number; durationMs: number; numScenarios: number }[] = [];

    for (const season of activeSeasons) {
      const league = await db.collection('leagues').findOne({ _id: season.leagueId });
      if (!league) continue;

      const result = await runSimulation(db, season.leagueId, season._id, numScenarios);
      const snapshotDate = getSnapshotDate(result.calculatedAt);

      await db.collection('simulation_results').updateOne(
        { leagueId: season.leagueId, seasonId: season._id, snapshotDate },
        { $set: { ...result, leagueId: season.leagueId, seasonId: season._id, snapshotDate } },
        { upsert: true },
      );

      results.push({
        league: league.slug,
        season: season.year,
        durationMs: result.durationMs,
        numScenarios,
      });
    }

    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error('[jobs/simulate-standings] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
