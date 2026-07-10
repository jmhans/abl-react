import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { runSimulation } from '@/app/lib/simulate-standings';
import { getAdminAuthState } from '@/app/lib/admin-auth';

/** GET /api/simulate-standings?league=abl&season=2025
 *  Returns the most recent stored simulation result for this league+season.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const leagueSlug = searchParams.get('league');
  const seasonSlug = searchParams.get('season') ?? 'active';

  if (!leagueSlug) {
    return NextResponse.json({ error: 'league param required' }, { status: 400 });
  }

  try {
    const db = await connectToDatabase();
    const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const result = await db.collection('simulation_results').findOne(
      { leagueId: ctx.league._id, seasonId: ctx.season._id },
      { sort: { calculatedAt: -1 } },
    );

    if (!result) {
      return NextResponse.json({ error: 'No simulation results found. Run POST to generate.' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** POST /api/simulate-standings?league=abl&season=2025&scenarios=1
 *  Runs the simulation and upserts results into MongoDB.
 *  Requires admin auth or CRON_SECRET header.
 */
export async function POST(request: NextRequest) {
  const { isAdmin } = await getAdminAuthState();
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!isAdmin && (!secret || token !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const leagueSlug = searchParams.get('league');
  const seasonSlug = searchParams.get('season') ?? 'active';
  const numScenarios = Math.max(1, parseInt(searchParams.get('scenarios') ?? '1', 10));

  if (!leagueSlug) {
    return NextResponse.json({ error: 'league param required' }, { status: 400 });
  }

  try {
    const db = await connectToDatabase();
    const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const result = await runSimulation(
      db,
      ctx.league._id,
      ctx.season._id,
      numScenarios,
    );

    // Upsert — one document per league+season (replace each run)
    await db.collection('simulation_results').updateOne(
      { leagueId: ctx.league._id, seasonId: ctx.season._id },
      {
        $set: {
          ...result,
          leagueId: ctx.league._id,
          seasonId: ctx.season._id,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({
      success: true,
      numScenarios,
      remainingGames: Object.keys(result.positionMatrix).length,
      durationMs: result.durationMs,
    });
  } catch (err) {
    console.error('[simulate-standings] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
