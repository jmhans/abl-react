import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { calculateAblScore } from '@/app/lib/roster-utils';
import { resolveLeagueContext } from '@/app/lib/league-context';

const CURRENT_SEASON = 2026;
// Stats written before Opening Day are from the prior season and should be hidden.
const SEASON_START = new Date('2026-03-26T00:00:00Z');

function currentSeasonStats(p: any): any {
  const lastUpdate = p.lastStatUpdate ? new Date(p.lastStatUpdate) : null;
  if (!lastUpdate || lastUpdate < SEASON_START) return undefined;
  return p.stats;
}

// GET /api/free-agents - Get paginated list of free agents
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '500');
    const search = searchParams.get('search') || '';
    const showAll = searchParams.get('showAll') === 'true';
    const projSystem = searchParams.get('projSystem') || '';

    const skip = (page - 1) * limit;
    const leagueSlug = searchParams.get('league') || '';
    const seasonSlug = searchParams.get('season') || 'active';

    // Derive "on roster in this league" from the lineups collection — the true source
    // of roster state, already updated on every add/drop/draft-finalize.
    // This avoids relying on the global (league-unscoped) ablstatus.onRoster flag.
    let rosteredPlayerIds: any[] = [];
    if (leagueSlug) {
      try {
        const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);
        // For each of this league's teams, grab the most recent lineup and collect
        // all player ObjectIds currently on any roster.
        const latestLineups = await db.collection('lineups').aggregate([
          { $match: { ablTeam: { $in: ctx.season.teamIds } } },
          { $sort: { effectiveDate: -1 } },
          { $group: { _id: '$ablTeam', roster: { $first: '$roster' } } },
        ]).toArray();
        for (const lu of latestLineups) {
          for (const entry of (lu.roster ?? [])) {
            rosteredPlayerIds.push(entry.player);
          }
        }
      } catch {
        // Unknown league/season — no exclusions (show all hitters)
      }
    }

    // Use players_cache (materialized from players_view) if it exists — fast find().
    // Falls back to players_view if the admin hasn't run refresh-cache yet.
    const cacheCount = await db.collection('players_cache').estimatedDocumentCount();
    const sourceCollection = cacheCount > 0 ? 'players_cache' : 'players_view';

    // Free agents = not in any of this league's current rosters.
    const notOnLeagueRoster = rosteredPlayerIds.length > 0
      ? { _id: { $nin: rosteredPlayerIds } }
      : {};

    // Exclude pitchers (same filter as /api/players)
    const notPitcher = {
      $or: [
        { 'eligible.0': { $exists: true } },
        { 'stats.batting.atBats': { $gt: 0 } },
      ],
    };

    const queryParts: any[] = [notPitcher];
    if (rosteredPlayerIds.length > 0) queryParts.push(notOnLeagueRoster);

    const query: any = { $and: queryParts };

    // Only filter by Active status if not showing all
    if (!showAll) {
      query.$and.push({ status: 'Active' });
    }

    if (search) {
      query.$and.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { mlbID: { $regex: search, $options: 'i' } },
        ],
      });
    }

    // Fetch projections for this system (if requested)
    let projMap = new Map<string, any>();
    if (projSystem) {
      const projRows = await db.collection('projections')
        .find(
          { season: CURRENT_SEASON, projSystem },
          { projection: { mlbId: 1, ablProjected: 1, projSystem: 1, stats: 1 } },
        )
        .toArray();
      for (const p of projRows) {
        if (p.mlbId && !projMap.has(p.mlbId)) {
          projMap.set(p.mlbId, p);
        }
      }
    }

    // Get total count
    const total = await db.collection(sourceCollection).countDocuments(query);

    // Get results — players_cache already has abl pre-computed and stale stats stripped
    let players = await db.collection(sourceCollection)
      .find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Attach projection data (and recompute abl/stats if falling back to players_view)
    players = players.map((p: any) => {
      const proj = p.mlbID ? projMap.get(String(p.mlbID)) ?? null : null;
      const base = sourceCollection === 'players_view'
        ? { ...p, stats: currentSeasonStats(p), abl: calculateAblScore(currentSeasonStats(p)) }
        : p;
      return {
        ...base,
        ablProjected: proj?.ablProjected ?? null,
        projSystem: proj?.projSystem ?? null,
        projStats: proj?.stats ?? null,
      };
    });

    // Default sort: ABL desc (projected ABL if projSystem requested, else actual)
    players.sort((a: any, b: any) => {
      const av = projSystem ? (a.ablProjected ?? -Infinity) : (a.abl ?? -Infinity);
      const bv = projSystem ? (b.ablProjected ?? -Infinity) : (b.abl ?? -Infinity);
      return bv - av;
    });

    return NextResponse.json({
      players,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Free agents error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch free agents' },
      { status: 500 }
    );
  }
}
