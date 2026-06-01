import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

/**
 * GET /api/supp-draft/order?league=abl&season=2026
 *
 * Returns teams ordered for supp draft selection:
 *   - Reverse standings (worst record first → first pick)
 *   - Tiebreak: lower average ABL runs gets the higher pick
 *
 * The response includes the sorted team list so the admin can preview/confirm
 * before creating the supp draft.
 */
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const leagueSlug = searchParams.get('league') || 'abl';
    const seasonSlug = searchParams.get('season') || 'active';
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    // Use the ObjectId directly (not .toString()) — same as standings API —
    // because games.seasonId is stored as ObjectId in MongoDB.
    const seasonId = season._id;
    const seasonTeamObjectIds = (season.teamIds || []).map((id: any) =>
      typeof id === 'string' ? new ObjectId(id) : id
    );

    // Get teams
    const teams = await db.collection('ablteams')
      .find({ _id: { $in: seasonTeamObjectIds } })
      .toArray();

    // Build standings from games for this season
    // We need: wins, losses, abl_runs for each team
    const games = await db.collection('games')
      .find(
        {
          seasonId,
          'result.isFinal': { $ne: false },
        },
        {
          projection: {
            'result.scores.team': 1,
            'result.scores.final.abl_runs': 1,
            'result.scores.regulation.abl_runs': 1,
            'result.winner': 1,
          },
        }
      )
      .toArray();

    type TeamStats = { w: number; l: number; ablRuns: number; g: number };
    const statsByTeam = new Map<string, TeamStats>();

    for (const teamId of seasonTeamObjectIds.map((id: any) => id.toString())) {
      statsByTeam.set(teamId, { w: 0, l: 0, ablRuns: 0, g: 0 });
    }

    for (const game of games) {
      const scores: any[] = game.result?.scores || [];
      if (scores.length < 2) continue;

      const scoreA = scores[0];
      const scoreB = scores[1];
      if (!scoreA?.team || !scoreB?.team) continue;

      const teamAId = String(scoreA.team);
      const teamBId = String(scoreB.team);
      const runsA = scoreA.final?.abl_runs ?? scoreA.regulation?.abl_runs ?? 0;
      const runsB = scoreB.final?.abl_runs ?? scoreB.regulation?.abl_runs ?? 0;

      const winner = game.result?.winner ? String(game.result.winner) : null;

      const statsA = statsByTeam.get(teamAId);
      const statsB = statsByTeam.get(teamBId);

      if (statsA) {
        statsA.ablRuns += runsA;
        statsA.g += 1;
        if (winner === teamAId) statsA.w += 1;
        else statsA.l += 1;
        statsByTeam.set(teamAId, statsA);
      }

      if (statsB) {
        statsB.ablRuns += runsB;
        statsB.g += 1;
        if (winner === teamBId) statsB.w += 1;
        else statsB.l += 1;
        statsByTeam.set(teamBId, statsB);
      }
    }

    // Sort: worst record first (fewest wins, most losses), tiebreak = lower avg ABL runs
    const sorted = teams
      .map((team: any) => {
        const teamId = team._id.toString();
        const stats = statsByTeam.get(teamId) ?? { w: 0, l: 0, ablRuns: 0, g: 0 };
        const avgAblRuns = stats.g > 0 ? stats.ablRuns / stats.g : 0;
        return {
          _id: teamId,
          nickname: team.nickname,
          location: team.location,
          owners: team.owners,
          w: stats.w,
          l: stats.l,
          g: stats.g,
          ablRuns: stats.ablRuns,
          avgAblRuns: Math.round(avgAblRuns * 100) / 100,
        };
      })
      .sort((a, b) => {
        // Fewest wins first
        if (a.w !== b.w) return a.w - b.w;
        // Most losses first (should be symmetric with wins, but just in case)
        if (b.l !== a.l) return b.l - a.l;
        // Tiebreak: lower avg ABL runs first (higher draft pick)
        return a.avgAblRuns - b.avgAblRuns;
      });

    return NextResponse.json({ order: sorted });
  } catch (error) {
    console.error('Error computing supp draft order:', error);
    return NextResponse.json({ error: 'Failed to compute draft order' }, { status: 500 });
  }
}
