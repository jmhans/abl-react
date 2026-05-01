import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { calculateAblScore } from '@/app/lib/roster-utils';
import { resolveLeagueContext } from '@/app/lib/league-context';

const SEASON_START = new Date('2026-03-26T00:00:00Z');

const POSITIONS = ['1B', '2B', '3B', 'SS', 'OF', 'C', 'DH'] as const;
type Position = typeof POSITIONS[number];

function currentSeasonStats(p: any): any {
  const lastUpdate = p.lastStatUpdate ? new Date(p.lastStatUpdate) : null;
  if (!lastUpdate || lastUpdate < SEASON_START) return undefined;
  return p.stats;
}

/** Plate Appearances = AB + BB + HBP + SAC + SF */
function calcPA(stats: any): number {
  if (!stats?.batting) return 0;
  const b = stats.batting;
  return (
    (b.atBats || 0) +
    (b.baseOnBalls || 0) +
    (b.hitByPitch || 0) +
    (b.sacBunts || 0) +
    (b.sacFlies || 0)
  );
}

/**
 * GET /api/leaders?league=xxx&season=yyy
 *
 * Returns the top 10 MLB players per ABL position (1B, 2B, 3B, SS, OF, C, DH)
 * ranked by regular-season computed ABL score.
 *
 * Minimum qualifier: ≥ 2 plate appearances per estimated team games played
 * (estimated as the maximum individual gamesPlayed among all players on the same MLB team).
 *
 * Each player entry includes:
 *   name, team (MLB), ablTeam (league-context ABL team name, or null), abl, pa
 */
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const searchParams = request.nextUrl.searchParams;
    const leagueSlug = searchParams.get('league') || '';
    const seasonSlug = searchParams.get('season') || 'active';

    // Resolve league context (optional — if not provided, ablTeam will be null for all)
    const ablTeamByPlayerId = new Map<string, { _id: string; nickname: string; location: string }>();
    if (leagueSlug) {
      try {
        const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);

        // Get teams for this season
        const teams = await db.collection('ablteams')
          .find({ _id: { $in: ctx.season.teamIds } })
          .project({ _id: 1, nickname: 1, location: 1 })
          .toArray();
        const teamMap = new Map(teams.map((t: any) => [t._id.toString(), t]));

        // For each team, get the latest lineup and map player IDs -> ABL team
        const latestLineups = await db.collection('lineups').aggregate([
          { $match: { ablTeam: { $in: ctx.season.teamIds } } },
          { $sort: { effectiveDate: -1 } },
          { $group: { _id: '$ablTeam', roster: { $first: '$roster' } } },
        ]).toArray();

        for (const lu of latestLineups) {
          const team = teamMap.get(lu._id.toString());
          if (!team) continue;
          for (const entry of (lu.roster ?? [])) {
            ablTeamByPlayerId.set(entry.player.toString(), {
              _id: team._id.toString(),
              nickname: team.nickname,
              location: team.location,
            });
          }
        }
      } catch {
        // Unknown league/season — no ABL team info
      }
    }

    // Use players_cache if populated, else fall back to players_view
    const cacheCount = await db.collection('players_cache').estimatedDocumentCount();
    const sourceCollection = cacheCount > 0 ? 'players_cache' : 'players_view';

    // Fetch all non-pitcher players (same filter as free-agents)
    const query = {
      $or: [
        { 'eligible.0': { $exists: true } },
        { 'stats.batting.atBats': { $gt: 0 } },
      ],
    };

    const rawPlayers = await db.collection(sourceCollection)
      .find(query)
      .project({
        _id: 1,
        name: 1,
        team: 1,
        mlbID: 1,
        eligible: 1,
        abl: 1,
        stats: 1,
        lastStatUpdate: 1,
        status: 1,
      })
      .toArray();

    // Normalize stats: strip stale data and compute abl if from players_view
    const players = rawPlayers.map((p: any) => {
      const stats = sourceCollection === 'players_view'
        ? currentSeasonStats(p)
        : p.stats;
      const abl = sourceCollection === 'players_view'
        ? calculateAblScore(stats)
        : (p.abl ?? calculateAblScore(stats));
      return { ...p, stats, abl };
    });

    // Compute max gamesPlayed per MLB team (approximates team's total games played)
    const teamMaxGames = new Map<string, number>();
    for (const p of players) {
      const mlbTeam = p.team;
      if (!mlbTeam) continue;
      const gp = p.stats?.batting?.gamesPlayed ?? 0;
      const prev = teamMaxGames.get(mlbTeam) ?? 0;
      if (gp > prev) teamMaxGames.set(mlbTeam, gp);
    }

    // Filter to qualifiers and enrich with ABL team info
    const qualifiedPlayers = players
      .filter((p: any) => {
        const stats = p.stats;
        if (!stats?.batting || (stats.batting.atBats ?? 0) === 0) return false;
        const mlbTeam = p.team;
        const teamGames = mlbTeam ? (teamMaxGames.get(mlbTeam) ?? 0) : 0;
        if (teamGames === 0) return false;
        const pa = calcPA(stats);
        return pa >= 2 * teamGames;
      })
      .map((p: any) => ({
        _id: p._id.toString(),
        name: p.name,
        team: p.team,
        mlbID: p.mlbID,
        eligible: Array.isArray(p.eligible) ? p.eligible : [],
        abl: typeof p.abl === 'number' ? p.abl : 0,
        pa: calcPA(p.stats),
        ablTeam: ablTeamByPlayerId.get(p._id.toString()) ?? null,
      }));

    // Build top-10 lists per position
    const result: Record<Position, any[]> = {
      '1B': [],
      '2B': [],
      '3B': [],
      'SS': [],
      'OF': [],
      'C': [],
      'DH': [],
    };

    for (const pos of POSITIONS) {
      result[pos] = qualifiedPlayers
        .filter((p) => p.eligible.includes(pos))
        .sort((a, b) => b.abl - a.abl)
        .slice(0, 10);
    }

    return NextResponse.json({ leaders: result });
  } catch (error) {
    console.error('Leaders error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaders' },
      { status: 500 }
    );
  }
}
