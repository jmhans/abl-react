import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

interface GameScoreLine {
  team?: string;
  final?: {
    abl_runs?: number;
  };
  regulation?: {
    abl_runs?: number;
  };
}

interface GameResult {
  scores?: GameScoreLine[];
}

interface GameForEra {
  result?: GameResult;
}

interface HittingStats {
  h: number;
  '2b': number;
  '3b': number;
  hr: number;
  bb: number;
  hbp: number;
  sac: number;
  sf: number;
  sb: number;
  cs: number;
  e: number;
  pb: number;
}

function emptyHittingStats(): HittingStats {
  return { h: 0, '2b': 0, '3b': 0, hr: 0, bb: 0, hbp: 0, sac: 0, sf: 0, sb: 0, cs: 0, e: 0, pb: 0 };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function getRunsAgainstFromOutcome(outcome: Record<string, unknown>): number | null {
  const candidates = [
    outcome.runsAgainst,
    outcome.runs_allowed,
    outcome.runsAllowed,
    outcome.ra,
    outcome.opp_abl_runs,
    outcome.opponentRuns,
    outcome.oppRuns,
  ];

  for (const candidate of candidates) {
    const value = toFiniteNumber(candidate);
    if (value !== null) return value;
  }

  return null;
}

function calculateEra(team: Record<string, unknown>, runsAgainstFromGames?: number): number | null {
  const existingEra = toFiniteNumber(team.era);
  if (existingEra !== null) return existingEra;

  const gamesPlayed = toFiniteNumber(team.g);
  if (!gamesPlayed || gamesPlayed <= 0) return null;

  const runsAgainstCandidates = [
    runsAgainstFromGames,
    team.runsAgainst,
    team.runs_allowed,
    team.runsAllowed,
    team.ra,
    team.opp_abl_runs,
  ];

  let runsAgainst: number | null = null;
  for (const candidate of runsAgainstCandidates) {
    const value = toFiniteNumber(candidate);
    if (value !== null) {
      runsAgainst = value;
      break;
    }
  }

  if (runsAgainst === null && Array.isArray(team.outcomes)) {
    const summedRunsAgainst = team.outcomes.reduce((total: number, outcome) => {
      if (!outcome || typeof outcome !== 'object') return total;
      const outcomeRunsAgainst = getRunsAgainstFromOutcome(outcome as Record<string, unknown>);
      return total + (outcomeRunsAgainst ?? 0);
    }, 0);
    runsAgainst = summedRunsAgainst > 0 ? summedRunsAgainst : null;
  }

  if (runsAgainst === null) return null;

  const errors = toFiniteNumber(team.e) ?? 0;
  // standings_view `pb` is passed balls and is included with `e` as unearned-run adjustments.
  const passedBalls = toFiniteNumber(team.pb) ?? 0;
  // Clamp to 0 for edge-case data where E + PB exceeds runs against.
  const earnedRunsAllowed = Math.max(0, runsAgainst - errors - passedBalls);
  return earnedRunsAllowed / gamesPlayed;
}

function extractRuns(scoreLine: GameScoreLine | undefined): number {
  if (!scoreLine) return 0;
  return scoreLine.final?.abl_runs ?? scoreLine.regulation?.abl_runs ?? 0;
}

function buildRunsAgainstMap(games: GameForEra[]): Map<string, number> {
  const runsAgainstByTeam = new Map<string, number>();

  for (const game of games) {
    const scores = game.result?.scores;
    if (!scores || scores.length < 2) continue;

    const first = scores[0];
    const second = scores[1];
    if (!first?.team || !second?.team) continue;

    const firstTeamId = String(first.team);
    const secondTeamId = String(second.team);
    const firstAllowed = extractRuns(second);
    const secondAllowed = extractRuns(first);

    runsAgainstByTeam.set(firstTeamId, (runsAgainstByTeam.get(firstTeamId) || 0) + firstAllowed);
    runsAgainstByTeam.set(secondTeamId, (runsAgainstByTeam.get(secondTeamId) || 0) + secondAllowed);
  }

  return runsAgainstByTeam;
}

function buildHittingStatsMap(games: any[]): Map<string, HittingStats> {
  const statsByTeam = new Map<string, HittingStats>();

  for (const game of games) {
    const scores = game.result?.scores;
    if (!scores) continue;

    for (const score of scores) {
      const teamId = String(score.team);
      const players: any[] = score.players || [];

      const current = statsByTeam.get(teamId) ?? emptyHittingStats();

      for (const player of players) {
        // Only count activated players (same logic as game calculation)
        const pos = player.playedPosition;
        if (!pos || pos === 'INJ') continue;

        const ds = player.dailyStats || {};
        current.h    += ds.h    || 0;
        current['2b'] += ds['2b'] || 0;
        current['3b'] += ds['3b'] || 0;
        current.hr   += ds.hr   || 0;
        current.bb   += ds.bb   || 0;
        current.hbp  += ds.hbp  || 0;
        current.sac  += ds.sac  || 0;
        current.sf   += ds.sf   || 0;
        current.sb   += ds.sb   || 0;
        current.cs   += ds.cs   || 0;
        current.e    += ds.e    || 0;
        current.pb   += ds.pb   || 0;
      }

      statsByTeam.set(teamId, current);
    }
  }

  return statsByTeam;
}

// GET /api/standings?league=abl&season=2025 - Get season-scoped standings
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const leagueSlug = searchParams.get('league');
    const seasonSlug = searchParams.get('season');

    let standings: any[];
    let baseMatch: Record<string, unknown> = { 'result.isFinal': { $ne: false } };

    if (leagueSlug && seasonSlug) {
      // Resolve the season to get its ObjectId
      const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);
      const seasonId = ctx.season._id;

      // Dynamically fetch both view pipelines so we stay in sync if views change
      const [standingsDef, advancedDef] = await Promise.all([
        db.listCollections({ name: 'standings_view' }).next() as Promise<any>,
        db.listCollections({ name: 'advanced_standings_view' }).next() as Promise<any>,
      ]);
      const advancedPipeline: any[] = advancedDef?.options?.pipeline ?? [];
      const standingsPipeline: any[] = standingsDef?.options?.pipeline ?? [];

      // Replace the "$lookup from: advanced_standings_view" stage with an inline
      // pipeline lookup on games so the advanced stats are also season-scoped.
      const scopedStandingsPipeline = standingsPipeline.map((stage: any) => {
        if (stage.$lookup?.from === 'advanced_standings_view') {
          return {
            $lookup: {
              as: 'AdvancedStandings',
              from: 'games',
              let: { nickname: '$tm.nickname' },
              pipeline: [
                // Season filter must be first so it runs on game documents
                { $match: { seasonId } },
                ...advancedPipeline,
                // Narrow to the single team being looked up
                { $match: { $expr: { $eq: ['$_id', '$$nickname'] } } },
              ],
            },
          };
        }
        return stage;
      });

      // Prepend the season $match and run directly on the games collection.
      // 'result.isFinal': {$ne:false} excludes in-progress results while keeping
      // records that pre-date the isFinal field (where the field is absent → treated as final).
      baseMatch = { seasonId, 'result.isFinal': { $ne: false } };
      standings = await db.collection('games')
        .aggregate([{ $match: baseMatch }, ...scopedStandingsPipeline])
        .toArray();
    } else {
      // Fallback: no season context — run the view pipeline inline so we can
      // inject the isFinal filter (excludes in-progress game results).
      const standingsDef = await db.listCollections({ name: 'standings_view' }).next() as any;
      const standingsPipeline: any[] = standingsDef?.options?.pipeline ?? [];
      baseMatch = { 'result.isFinal': { $ne: false } };
      standings = await db.collection('games')
        .aggregate([{ $match: baseMatch }, ...standingsPipeline])
        .toArray();
    }

    const gamesForEra = await db.collection('games')
      .find(
        baseMatch,
        {
          projection: {
            'result.scores.team': 1,
            'result.scores.final.abl_runs': 1,
            'result.scores.regulation.abl_runs': 1,
          },
        }
      )
      .toArray() as GameForEra[];
    const runsAgainstByTeam = buildRunsAgainstMap(gamesForEra);

    // Aggregate hitting stats from game player data (covers existing games that may not
    // have these fields stored in regulation, as well as all newly calculated games).
    const gamesForHitting = await db.collection('games')
      .find(
        baseMatch,
        {
          projection: {
            'result.scores.team': 1,
            'result.scores.players.playedPosition': 1,
            'result.scores.players.dailyStats': 1,
          },
        }
      )
      .toArray();
    const hittingStatsByTeam = buildHittingStatsMap(gamesForHitting);

    // Calculate games behind (GB)
    // Find the best record
    const topRecord = standings.reduce((best, team) => {
      const diff = (team.w || 0) - (team.l || 0);
      return Math.max(best, diff);
    }, -Infinity);

    // Add GB and calculated stats to each team
    const enrichedStandings = standings.map(team => {
      const gb = (topRecord - ((team.w || 0) - (team.l || 0))) / 2;
      const wpct = team.g > 0 ? team.w / team.g : 0;
      
      // Calculate streak from outcomes array
      let streak = '';
      if (team.outcomes && Array.isArray(team.outcomes) && team.outcomes.length > 0) {
        const sortedGames = [...team.outcomes].sort((a, b) => 
          new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime()
        );
        const lastOutcome = sortedGames[0]?.outcome?.toUpperCase();
        let count = 0;
        for (const game of sortedGames) {
          if (game.outcome?.toUpperCase() === lastOutcome) {
            count++;
          } else {
            break;
          }
        }
        streak = `${lastOutcome}${count}`;
      }

      // Calculate L10 from outcomes array
      let l10 = '';
      if (team.outcomes && Array.isArray(team.outcomes) && team.outcomes.length > 0) {
        const sortedGames = [...team.outcomes].sort((a, b) => 
          new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime()
        );
        const last10 = sortedGames.slice(0, 10);
        const wins = last10.filter(g => g.outcome?.toLowerCase() === 'w').length;
        const losses = last10.filter(g => g.outcome?.toLowerCase() === 'l').length;
        l10 = `${wins}-${losses}`;
      }

      // Calculate split records
      let homeRecord = '';
      let awayRecord = '';
      let xtrasRecord = '';
      if (team.outcomes && Array.isArray(team.outcomes)) {
        const homeGames = team.outcomes.filter((g: any) => g.location === 'H');
        const awayGames = team.outcomes.filter((g: any) => g.location === 'A');
        const extrasGames = team.outcomes.filter((g: any) => g.extras === true);
        
        const homeW = homeGames.filter((g: any) => g.outcome?.toLowerCase() === 'w').length;
        const homeL = homeGames.filter((g: any) => g.outcome?.toLowerCase() === 'l').length;
        homeRecord = `${homeW}-${homeL}`;
        
        const awayW = awayGames.filter((g: any) => g.outcome?.toLowerCase() === 'w').length;
        const awayL = awayGames.filter((g: any) => g.outcome?.toLowerCase() === 'l').length;
        awayRecord = `${awayW}-${awayL}`;
        
        const xtrasW = extrasGames.filter((g: any) => g.outcome?.toLowerCase() === 'w').length;
        const xtrasL = extrasGames.filter((g: any) => g.outcome?.toLowerCase() === 'l').length;
        xtrasRecord = `${xtrasW}-${xtrasL}`;
      }

      // Get DougLuck stats from AdvancedStandings
      const dougluckw = team.AdvancedStandings?.avgW || 0;
      const dougluckl = team.AdvancedStandings?.avgL || 0;
      const dougluckExcessW = (team.w || 0) - dougluckw;
      const teamId = String(team.tm?._id ?? team._id ?? '');
      const hitting = hittingStatsByTeam.get(teamId) ?? emptyHittingStats();
      // Use player-aggregated e and pb (more reliable than standings_view aggregation)
      const era = calculateEra({ ...team, e: hitting.e, pb: hitting.pb }, runsAgainstByTeam.get(teamId));

      // Use player-aggregated hitting stats (computed directly from game player data
      // so they are correct for both existing and newly calculated games).
      const h = hitting.h;
      const batAvg = team.ab > 0 ? h / team.ab : 0;

      return {
        _id: team._id,
        tm: team.tm,
        g: team.g,
        w: team.w,
        l: team.l,
        ab: team.ab,
        h,
        '2b': hitting['2b'],
        '3b': hitting['3b'],
        hr: hitting.hr,
        bb: hitting.bb,
        hbp: hitting.hbp,
        sac: hitting.sac,
        sf: hitting.sf,
        sb: hitting.sb,
        cs: hitting.cs,
        e: hitting.e,
        pb: hitting.pb,
        abl_runs: team.abl_runs,
        era,
        gb: gb.toFixed(1),
        wpct: wpct.toFixed(3),
        batAvg: batAvg.toFixed(3),
        streak,
        l10,
        homeRecord,
        awayRecord,
        xtrasRecord,
        dougluckw,
        dougluckl,
        dougluckExcessW
      };
    });

    // Sort by wins descending, then by win percentage
    enrichedStandings.sort((a, b) => {
      if (b.w !== a.w) return b.w - a.w;
      return parseFloat(b.wpct) - parseFloat(a.wpct);
    });

    return NextResponse.json(enrichedStandings);
  } catch (error) {
    console.error('Error fetching standings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch standings', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
