import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { computePlayerSplits } from '@/app/lib/stat-splits';

const MAX_DAYS = 60;
const MAX_IDS  = 2000;

/**
 * POST /api/players/splits
 *
 * Body:
 *   mlbIds  string[]   — MLB player IDs to compute splits for
 *   days    number[]   — e.g. [7, 10, 14, 20, 30]
 *   league  string     — league slug (used to find first ABL game date)
 *   season  string     — season slug or "active"
 *
 * Returns:
 *   { splits: Record<mlbId, { lastN, ablOn, ablOff }> }
 */
export async function POST(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const body = await request.json();

    const {
      mlbIds,
      days     = [10, 20],
      league   = '',
      season   = 'active',
    } = body as {
      mlbIds?: unknown;
      days?:   unknown;
      league?: string;
      season?: string;
    };

    // Validate mlbIds
    if (!Array.isArray(mlbIds) || mlbIds.length === 0) {
      return NextResponse.json({ error: 'mlbIds array required' }, { status: 400 });
    }
    const cleanIds = [...new Set(
      mlbIds
        .map((id: unknown) => String(id).trim())
        .filter(Boolean),
    )].slice(0, MAX_IDS);

    // Validate days
    const rawDays = Array.isArray(days) ? days : [days];
    const cleanDays = rawDays
      .map((n: unknown) => parseInt(String(n), 10))
      .filter((n) => !isNaN(n) && n > 0 && n <= MAX_DAYS);

    if (cleanDays.length === 0) {
      return NextResponse.json({ error: 'No valid days specified' }, { status: 400 });
    }

    // Resolve league team IDs (for ABL season-start detection)
    let leagueTeamIds: any[] = [];
    let seasonId: any = undefined;
    if (league) {
      try {
        const ctx = await resolveLeagueContext(db, league, season);
        leagueTeamIds = ctx.season.teamIds;
        seasonId = ctx.season._id;
      } catch {
        // Unknown league — on/off classification will be disabled
      }
    }

    const splits = await computePlayerSplits(db, cleanIds, {
      lastNDays: cleanDays,
      leagueTeamIds,
      seasonId,
    });

    return NextResponse.json({ splits });
  } catch (err) {
    console.error('[/api/players/splits]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
