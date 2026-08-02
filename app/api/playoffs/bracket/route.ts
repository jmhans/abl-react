import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

// GET /api/playoffs/bracket?league=<slug>&season=<slug>
// Public read (matches other read-only data routes like /api/games, /api/standings).
// Returns { status: 'not_started' } if no bracket doc exists yet for the season.
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const leagueSlug = searchParams.get('league');
    const seasonSlug = searchParams.get('season');

    if (!leagueSlug || !seasonSlug) {
      return NextResponse.json({ error: 'league and season query params are required' }, { status: 400 });
    }

    const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);
    const bracket = await db.collection('playoff_brackets').findOne({ _id: ctx.season._id as any });

    if (!bracket) {
      return NextResponse.json({ status: 'not_started' });
    }

    // Collect every team id referenced anywhere in the bracket.
    const teamIds = new Set<string>();
    for (const seed of bracket.seeds ?? []) teamIds.add(seed.teamId.toString());
    for (const group of bracket.tiebreaks ?? []) {
      for (const id of group.teamIds ?? []) teamIds.add(id.toString());
    }
    for (const s of bracket.series ?? []) {
      if (s.higherSeedTeamId) teamIds.add(s.higherSeedTeamId.toString());
      if (s.lowerSeedTeamId) teamIds.add(s.lowerSeedTeamId.toString());
      if (s.winnerTeamId) teamIds.add(s.winnerTeamId.toString());
      if (s.loserTeamId) teamIds.add(s.loserTeamId.toString());
    }

    const teams = await db.collection('ablteams')
      .find({ _id: { $in: Array.from(teamIds).map((id) => new ObjectId(id)) } })
      .project({ nickname: 1, location: 1 })
      .toArray();
    const teamMap = new Map(teams.map((t: any) => [t._id.toString(), t]));
    const populateTeam = (id: any) => (id ? teamMap.get(id.toString()) ?? null : null);

    // Collect every game id referenced (tiebreaks + series) for a lean summary fetch.
    const gameIds = new Set<string>();
    for (const group of bracket.tiebreaks ?? []) {
      for (const id of group.gameIds ?? []) gameIds.add(id.toString());
    }
    for (const s of bracket.series ?? []) {
      for (const id of s.gameIds ?? []) gameIds.add(id.toString());
    }

    const games = await db.collection('games')
      .find({ _id: { $in: Array.from(gameIds).map((id) => new ObjectId(id)) } })
      .project({
        homeTeam: 1,
        awayTeam: 1,
        gameDate: 1,
        cancelled: 1,
        playoff: 1,
        'result.isFinal': 1,
        'result.winner': 1,
        'result.loser': 1,
        'result.scores.team': 1,
        'result.scores.final.abl_runs': 1,
        'result.scores.regulation.abl_runs': 1,
      })
      .toArray();
    const gameMap = new Map(games.map((g: any) => [g._id.toString(), g]));
    const populateGames = (ids: any[]) => (ids ?? []).map((id) => gameMap.get(id.toString())).filter(Boolean);

    const response = {
      status: bracket.status,
      seeds: (bracket.seeds ?? []).map((s: any) => ({ seed: s.seed, team: populateTeam(s.teamId) })),
      tiebreaks: (bracket.tiebreaks ?? []).map((group: any) => ({
        groupId: group.groupId,
        lineageId: group.lineageId,
        round: group.round,
        seedTargets: group.seedTargets,
        teams: (group.teamIds ?? []).map(populateTeam),
        games: populateGames(group.gameIds),
        ablDate: group.ablDate,
        status: group.status,
        resolvedOrder: group.resolvedOrder ? group.resolvedOrder.map(populateTeam) : null,
      })),
      series: (bracket.series ?? []).map((s: any) => ({
        seriesId: s.seriesId,
        round: s.round,
        higherSeedTeam: populateTeam(s.higherSeedTeamId),
        lowerSeedTeam: populateTeam(s.lowerSeedTeamId),
        higherSeedOriginalSeed: s.higherSeedOriginalSeed,
        lowerSeedOriginalSeed: s.lowerSeedOriginalSeed,
        games: populateGames(s.gameIds),
        status: s.status,
        winnerTeam: populateTeam(s.winnerTeamId),
        loserTeam: populateTeam(s.loserTeamId),
        clinchedAtGameNumber: s.clinchedAtGameNumber,
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching playoff bracket:', error);
    return NextResponse.json(
      { error: 'Failed to fetch playoff bracket', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
