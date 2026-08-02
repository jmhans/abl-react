import { Db, ObjectId } from 'mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

const STANDINGS_CACHE_COLLECTION = 'standings_cache';

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

interface TeamGameStats {
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

function emptyTeamGameStats(): TeamGameStats {
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

/**
 * Aggregates per-player daily hitting/fielding stats into team totals directly in Mongo
 * ($unwind + $group) instead of pulling every game's full nested player array into Node.
 * Mirrors the DH/XTRA exclusion for e/pb that calculateTeamScore uses in game-utils.ts.
 */
async function buildTeamGameStatsMap(db: Db, baseMatch: Record<string, unknown>): Promise<Map<string, TeamGameStats>> {
  const pipeline = [
    { $match: baseMatch },
    { $project: { 'result.scores': 1 } },
    { $unwind: '$result.scores' },
    { $unwind: '$result.scores.players' },
    {
      $match: {
        'result.scores.players.playedPosition': { $exists: true, $ne: null, $nin: ['INJ'] },
      },
    },
    {
      $group: {
        _id: '$result.scores.team',
        h: { $sum: { $ifNull: ['$result.scores.players.dailyStats.h', 0] } },
        '2b': { $sum: { $ifNull: ['$result.scores.players.dailyStats.2b', 0] } },
        '3b': { $sum: { $ifNull: ['$result.scores.players.dailyStats.3b', 0] } },
        hr: { $sum: { $ifNull: ['$result.scores.players.dailyStats.hr', 0] } },
        bb: { $sum: { $ifNull: ['$result.scores.players.dailyStats.bb', 0] } },
        hbp: { $sum: { $ifNull: ['$result.scores.players.dailyStats.hbp', 0] } },
        sac: { $sum: { $ifNull: ['$result.scores.players.dailyStats.sac', 0] } },
        sf: { $sum: { $ifNull: ['$result.scores.players.dailyStats.sf', 0] } },
        sb: { $sum: { $ifNull: ['$result.scores.players.dailyStats.sb', 0] } },
        cs: { $sum: { $ifNull: ['$result.scores.players.dailyStats.cs', 0] } },
        e: {
          $sum: {
            $cond: [
              { $in: ['$result.scores.players.playedPosition', ['DH', 'XTRA']] },
              0,
              { $ifNull: ['$result.scores.players.dailyStats.e', 0] },
            ],
          },
        },
        pb: {
          $sum: {
            $cond: [
              { $in: ['$result.scores.players.playedPosition', ['DH', 'XTRA']] },
              0,
              { $ifNull: ['$result.scores.players.dailyStats.pb', 0] },
            ],
          },
        },
      },
    },
  ];

  const rows = await db.collection('games').aggregate(pipeline, { allowDiskUse: true }).toArray();
  const statsByTeam = new Map<string, TeamGameStats>();
  for (const row of rows) {
    statsByTeam.set(String(row._id), {
      h: row.h ?? 0,
      '2b': row['2b'] ?? 0,
      '3b': row['3b'] ?? 0,
      hr: row.hr ?? 0,
      bb: row.bb ?? 0,
      hbp: row.hbp ?? 0,
      sac: row.sac ?? 0,
      sf: row.sf ?? 0,
      sb: row.sb ?? 0,
      cs: row.cs ?? 0,
      e: row.e ?? 0,
      pb: row.pb ?? 0,
    });
  }
  return statsByTeam;
}

/** Computes the full enriched standings array for a resolved league+season. Mirrors the
 * previous inline logic in app/api/standings/route.ts, but sources hitting stats via an
 * in-database aggregation instead of pulling raw per-player data into Node. */
export async function computeStandingsForSeason(
  db: Db,
  leagueSlug: string,
  seasonSlug: string
): Promise<{ standings: any[]; seasonId: ObjectId; leagueId: ObjectId }> {
  const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);
  const seasonId = ctx.season._id;
  const leagueId = ctx.league._id;

  const [standingsDef, advancedDef] = await Promise.all([
    db.listCollections({ name: 'standings_view' }).next() as Promise<any>,
    db.listCollections({ name: 'advanced_standings_view' }).next() as Promise<any>,
  ]);
  const advancedPipeline: any[] = advancedDef?.options?.pipeline ?? [];
  const standingsPipeline: any[] = standingsDef?.options?.pipeline ?? [];

  const scopedStandingsPipeline = standingsPipeline.map((stage: any) => {
    if (stage.$lookup?.from === 'advanced_standings_view') {
      return {
        $lookup: {
          as: 'AdvancedStandings',
          from: 'games',
          let: { nickname: '$tm.nickname' },
          pipeline: [
            // gameType: 'R' — playoff/tiebreak games (gameType 'P') must never count
            // toward regular-season standings.
            { $match: { seasonId, gameType: 'R' } },
            ...advancedPipeline,
            { $match: { $expr: { $eq: ['$_id', '$$nickname'] } } },
          ],
        },
      };
    }
    return stage;
  });

  // gameType: 'R' — playoff/tiebreak games (gameType 'P') must never count toward
  // regular-season standings.
  const baseMatch = { seasonId, gameType: 'R', 'result.isFinal': { $ne: false } };
  const standings = await db.collection('games')
    .aggregate([{ $match: baseMatch }, ...scopedStandingsPipeline])
    .toArray();

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

  const hittingStatsByTeam = await buildTeamGameStatsMap(db, baseMatch);

  const topRecord = standings.reduce((best, team) => {
    const diff = (team.w || 0) - (team.l || 0);
    return Math.max(best, diff);
  }, -Infinity);

  const enrichedStandings = standings.map(team => {
    const gb = (topRecord - ((team.w || 0) - (team.l || 0))) / 2;
    const wpct = team.g > 0 ? team.w / team.g : 0;

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

    const dougluckw = team.AdvancedStandings?.avgW || 0;
    const dougluckl = team.AdvancedStandings?.avgL || 0;
    const dougluckExcessW = (team.w || 0) - dougluckw;
    const teamId = String(team.tm?._id ?? team._id ?? '');
    const hitting = hittingStatsByTeam.get(teamId) ?? emptyTeamGameStats();
    const era = calculateEra({ ...team, e: hitting.e, pb: hitting.pb }, runsAgainstByTeam.get(teamId));

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

  enrichedStandings.sort((a, b) => {
    if (b.w !== a.w) return b.w - a.w;
    return parseFloat(b.wpct) - parseFloat(a.wpct);
  });

  return { standings: enrichedStandings, seasonId, leagueId };
}

/** Recomputes standings for a league+season and upserts the result into standings_cache,
 * keyed by seasonId. Callers read from this cache instead of recomputing on every request. */
export async function refreshStandingsCache(db: Db, leagueSlug: string, seasonSlug: string) {
  const { standings, seasonId, leagueId } = await computeStandingsForSeason(db, leagueSlug, seasonSlug);
  const calculatedAt = new Date();

  await db.collection(STANDINGS_CACHE_COLLECTION).updateOne(
    { _id: seasonId as any },
    {
      $set: {
        leagueId,
        leagueSlug,
        seasonSlug,
        standings,
        calculatedAt,
      },
    },
    { upsert: true }
  );

  return { standings, calculatedAt };
}

/** Reads cached standings for a league+season, if present. */
export async function getCachedStandings(
  db: Db,
  leagueSlug: string,
  seasonSlug: string
): Promise<{ standings: any[]; calculatedAt: Date } | null> {
  const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);
  const cached = await db.collection(STANDINGS_CACHE_COLLECTION).findOne({ _id: ctx.season._id as any });
  if (!cached) return null;
  return { standings: cached.standings, calculatedAt: cached.calculatedAt };
}

/** Refreshes the standings cache for whichever league+season a given game belongs to.
 * Intended to be called after a game result is calculated/finalized so the cache stays
 * fresh without needing every page load to recompute from raw game data. Failures are
 * swallowed by the caller (game-result calculation should not fail because of this). */
export async function refreshStandingsCacheForGame(db: Db, game: Record<string, any>) {
  if (!game.leagueId || !game.seasonId) return;

  const [league, season] = await Promise.all([
    db.collection('leagues').findOne({ _id: game.leagueId }),
    db.collection('seasons').findOne({ _id: game.seasonId }),
  ]);
  if (!league?.slug || !season?.slug) return;

  await refreshStandingsCache(db, league.slug, season.slug);
}
