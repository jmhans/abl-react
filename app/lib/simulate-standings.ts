import { Db, ObjectId } from 'mongodb';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamRunStats {
  mean: number;
  std: number;
  n: number; // number of unique game-days used in the sample
}

export interface SimulationResult {
  leagueId: string;
  seasonId: string;
  calculatedAt: Date;
  numScenarios: number;
  /** Per-team offensive stats derived from regulation scores (HTA removed, one game per team-day) */
  teamStats: Record<string, TeamRunStats>;
  /**
   * positionMatrix[teamId][position] = probability (0–1)
   * e.g. positionMatrix["abc"]["1"] = 0.45 means 45% chance of finishing 1st
   */
  positionMatrix: Record<string, Record<string, number>>;
  /** Average projected final wins across all scenarios */
  projectedWins: Record<string, number>;
  /** Human-readable team names keyed by team _id string */
  teamNames: Record<string, string>;
  /** Team ordering (by projected wins desc) for display */
  teamOrder: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/** Box-Muller transform: sample from N(mean, std), clipped to 0 */
function sampleNormal(mean: number, std: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, mean + z * std);
}

/** Sample mean and Bessel-corrected std dev; returns a safe fallback if n < 2 */
function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 6.0, std: 1.5 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, std: 1.5 };
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.max(Math.sqrt(variance), 0.1) };
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/** Fetch regulation run samples per team from final, played games.
 *  Rules applied:
 *  1. Only `result.isFinal === true` games.
 *  2. Only regulation scores (score.regulation.abl_runs), not final/XTRA.
 *  3. HTA stripped: subtract 0.5 from the home team's score.
 *  4. Deduplicate: at most one game per (teamId, calendar date).
 */
export async function getTeamRunStats(
  db: Db,
  leagueId: ObjectId,
  seasonId: ObjectId,
): Promise<Record<string, TeamRunStats>> {
  const games = await db.collection('games').find(
    {
      leagueId,
      seasonId,
      'result.isFinal': true,
    },
    {
      projection: {
        gameDate: 1,
        'result.scores.team': 1,
        'result.scores.location': 1,
        'result.scores.regulation.abl_runs': 1,
      },
    }
  ).toArray();

  const usedDates = new Map<string, Set<string>>(); // teamId -> Set<YYYY-MM-DD>
  const teamRuns = new Map<string, number[]>();

  for (const game of games) {
    const dateStr = new Date(game.gameDate).toISOString().slice(0, 10);
    const scores: any[] = game.result?.scores ?? [];

    for (const score of scores) {
      const teamId: string | undefined = score.team?.toString();
      if (!teamId) continue;

      // Dedup: only count one game per team per calendar day
      if (!usedDates.has(teamId)) usedDates.set(teamId, new Set());
      if (usedDates.get(teamId)!.has(dateStr)) continue;
      usedDates.get(teamId)!.add(dateStr);

      const ablRuns: unknown = score.regulation?.abl_runs;
      if (typeof ablRuns !== 'number' || !isFinite(ablRuns)) continue;

      // Strip home team advantage (+0.5 was baked in at calc time)
      const isHome = score.location === 'H';
      const neutralRuns = ablRuns - (isHome ? 0.5 : 0);

      if (!teamRuns.has(teamId)) teamRuns.set(teamId, []);
      teamRuns.get(teamId)!.push(neutralRuns);
    }
  }

  const result: Record<string, TeamRunStats> = {};
  for (const [teamId, runs] of teamRuns) {
    const { mean, std } = meanStd(runs);
    result[teamId] = { mean, std, n: runs.length };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export async function runSimulation(
  db: Db,
  leagueId: ObjectId,
  seasonId: ObjectId,
  numScenarios: number,
): Promise<SimulationResult> {
  const startMs = Date.now();

  // --- 1. Team offensive stats ---
  const teamStats = await getTeamRunStats(db, leagueId, seasonId);

  // --- 2. Actual W/L from completed games ---
  const playedGames = await db.collection('games').find(
    {
      leagueId,
      seasonId,
      'result.isFinal': true,
    },
    { projection: { 'result.winner': 1, 'result.loser': 1 } }
  ).toArray();

  const actualWins: Record<string, number> = {};
  const actualLosses: Record<string, number> = {};

  for (const game of playedGames) {
    const winnerId = game.result?.winner?._id?.toString() ?? game.result?.winner?.toString();
    const loserId = game.result?.loser?._id?.toString() ?? game.result?.loser?.toString();
    if (winnerId) actualWins[winnerId] = (actualWins[winnerId] ?? 0) + 1;
    if (loserId) actualLosses[loserId] = (actualLosses[loserId] ?? 0) + 1;
  }

  // --- 3. Remaining (unplayed) games ---
  const remainingGames = await db.collection('games').find(
    {
      leagueId,
      seasonId,
      result: { $exists: false },
    },
    { projection: { homeTeam: 1, awayTeam: 1 } }
  ).toArray();

  // --- 4. Full team list from season ---
  const season = await db.collection('seasons').findOne({ _id: seasonId });
  const teamObjIds: ObjectId[] = season?.teamIds ?? [];
  const teamIds = teamObjIds.map((id) => id.toString());

  const teams = await db.collection('ablteams').find({
    _id: { $in: teamObjIds },
  }).toArray();
  const teamNames: Record<string, string> = {};
  for (const t of teams) {
    teamNames[t._id.toString()] = `${t.location ?? ''} ${t.nickname ?? ''}`.trim();
  }

  // --- 5. Simulation ---
  const positionCounts: Record<string, Record<string, number>> = {};
  const totalProjectedWins: Record<string, number> = {};
  for (const id of teamIds) {
    positionCounts[id] = {};
    totalProjectedWins[id] = 0;
  }

  // Precompute fallback stats in case a team has no played-game data yet
  const leagueMeanFallback = (() => {
    const all = Object.values(teamStats).map((s) => s.mean);
    return all.length > 0 ? all.reduce((a, b) => a + b, 0) / all.length : 6.0;
  })();
  const leagueStdFallback = (() => {
    const all = Object.values(teamStats).map((s) => s.std);
    return all.length > 0 ? all.reduce((a, b) => a + b, 0) / all.length : 1.5;
  })();

  for (let s = 0; s < numScenarios; s++) {
    // Clone actual W/L
    const wins: Record<string, number> = { ...actualWins };
    const losses: Record<string, number> = { ...actualLosses };
    for (const id of teamIds) {
      if (wins[id] === undefined) wins[id] = 0;
      if (losses[id] === undefined) losses[id] = 0;
    }

    // Simulate each remaining game
    for (const game of remainingGames) {
      const homeId = game.homeTeam?.toString();
      const awayId = game.awayTeam?.toString();
      if (!homeId || !awayId) continue;

      const homeStats = teamStats[homeId] ?? { mean: leagueMeanFallback, std: leagueStdFallback };
      const awayStats = teamStats[awayId] ?? { mean: leagueMeanFallback, std: leagueStdFallback };

      const homeRuns = sampleNormal(homeStats.mean, homeStats.std);
      const awayRuns = sampleNormal(awayStats.mean, awayStats.std);

      let homeWins: boolean;
      if (homeRuns !== awayRuns) {
        homeWins = homeRuns > awayRuns;
      } else {
        homeWins = Math.random() < 0.5; // exact tie: coin flip
      }

      if (homeWins) {
        wins[homeId] = (wins[homeId] ?? 0) + 1;
        losses[awayId] = (losses[awayId] ?? 0) + 1;
      } else {
        wins[awayId] = (wins[awayId] ?? 0) + 1;
        losses[homeId] = (losses[homeId] ?? 0) + 1;
      }
    }

    // Rank teams: wins desc, then win% desc, then random for true ties
    const sorted = [...teamIds].sort((a, b) => {
      const wA = wins[a] ?? 0, wB = wins[b] ?? 0;
      if (wB !== wA) return wB - wA;
      const gA = wA + (losses[a] ?? 0), gB = wB + (losses[b] ?? 0);
      const pctA = gA > 0 ? wA / gA : 0, pctB = gB > 0 ? wB / gB : 0;
      if (Math.abs(pctB - pctA) > 1e-9) return pctB - pctA;
      return Math.random() - 0.5; // random tiebreak (user to refine later)
    });

    for (let rank = 0; rank < sorted.length; rank++) {
      const id = sorted[rank];
      const pos = String(rank + 1);
      positionCounts[id][pos] = (positionCounts[id][pos] ?? 0) + 1;
      totalProjectedWins[id] = (totalProjectedWins[id] ?? 0) + (wins[id] ?? 0);
    }
  }

  // --- 6. Convert counts to probabilities ---
  const positionMatrix: Record<string, Record<string, number>> = {};
  const projectedWins: Record<string, number> = {};
  for (const id of teamIds) {
    positionMatrix[id] = {};
    for (const [pos, count] of Object.entries(positionCounts[id])) {
      positionMatrix[id][pos] = count / numScenarios;
    }
    projectedWins[id] = totalProjectedWins[id] / numScenarios;
  }

  // Sort teams by projected wins for display
  const teamOrder = [...teamIds].sort(
    (a, b) => (projectedWins[b] ?? 0) - (projectedWins[a] ?? 0),
  );

  return {
    leagueId: leagueId.toString(),
    seasonId: seasonId.toString(),
    calculatedAt: new Date(),
    numScenarios,
    teamStats,
    positionMatrix,
    projectedWins,
    teamNames,
    teamOrder,
    durationMs: Date.now() - startMs,
  };
}
