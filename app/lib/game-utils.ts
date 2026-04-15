import { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { calculateAblPoints } from './roster-utils';

// === CONSTANTS ===

/** ABL lineup slot order. Index = ablRosterPosition */
const ABL_STARTERS = ['1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF', 'C', 'DH'] as const;

/** Positions eligible in non-roster spots (DH/XTRA) */
const VALID_POSITIONS = ['1B', '2B', '3B', 'SS', 'OF', 'C', 'DH'];

// === HELPERS ===

/**
 * Actuarial Plate Appearances = AB + BB + HBP + SAC + SF
 */
function calcAPA(stats: any): number {
  return (stats?.ab || 0) + (stats?.bb || 0) + (stats?.hbp || 0) + (stats?.sac || 0) + (stats?.sf || 0);
}

/**
 * Can a player at lineupPosition fill the given lineup slot?
 * DH/XTRA: any valid position. Otherwise exact match.
 */
function canPlaySlot(lineupPosition: string, slot: string): boolean {
  if (slot === 'DH' || slot === 'XTRA') {
    return VALID_POSITIONS.includes(lineupPosition);
  }
  return lineupPosition === slot;
}

function deriveAblDate(gameDate: string | Date): string {
  const dt = new Date(gameDate);
  const shifted = new Date(dt.getTime() - 8 * 60 * 60 * 1000);
  return shifted.toISOString().substring(0, 10);
}

/**
 * Parse a raw statline document into flat daily stats.
 * Handles both "modified" (flat) and nested batting/fielding formats.
 */
function parseDailyStats(statlineDoc: any): any {
  const s = statlineDoc.stats;
  if (!s) return null;

  let stats: any;
  if (s.modified) {
    // Already-flattened format
    stats = {
      mlbId: statlineDoc.mlbId,
      gamePk: statlineDoc.gamePk,
      gameDate: statlineDoc.gameDate,
      g: s.g || 0,
      ab: s.ab || 0,
      h: s.h || 0,
      '2b': s['2b'] || 0,
      '3b': s['3b'] || 0,
      hr: s.hr || 0,
      bb: s.bb || 0,
      ibb: s.ibb || 0,
      hbp: s.hbp || 0,
      sb: s.sb || 0,
      cs: s.cs || 0,
      sac: s.sac || 0,
      sf: s.sf || 0,
      po: s.po || 0,
      pb: s.pb || 0,
      e: s.e || 0,
    };
  } else {
    // Nested batting/fielding format (standard MLB API shape)
    stats = {
      mlbId: statlineDoc.mlbId,
      gamePk: statlineDoc.gamePk,
      gameDate: statlineDoc.gameDate,
      g: s.batting?.gamesPlayed || 0,
      ab: s.batting?.atBats || 0,
      h: s.batting?.hits || 0,
      '2b': s.batting?.doubles || 0,
      '3b': s.batting?.triples || 0,
      hr: s.batting?.homeRuns || 0,
      bb: s.batting?.baseOnBalls || 0,
      ibb: s.batting?.intentionalWalks || 0,
      hbp: s.batting?.hitByPitch || 0,
      sb: s.batting?.stolenBases || 0,
      cs: s.batting?.caughtStealing || 0,
      sac: s.batting?.sacBunts || 0,
      sf: s.batting?.sacFlies || 0,
      po: s.batting?.pickoffs || 0,
      e: s.fielding?.e || 0,
      pb: s.fielding?.passedBall || 0,
    };
  }

  stats.abl_points = calculateAblPoints(stats);
  return stats;
}

/** Empty daily stats sentinel (player not in box score) */
function emptyStats(): any {
  return { g: 0, ab: 0, h: 0, '2b': 0, '3b': 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sb: 0, cs: 0, sac: 0, sf: 0, po: 0, e: 0, pb: 0, abl_points: 0 };
}

const STAT_FIELDS = ['g', 'ab', 'h', '2b', '3b', 'hr', 'bb', 'ibb', 'hbp', 'sb', 'cs', 'sac', 'sf', 'po', 'e', 'pb'] as const;

/**
 * Parse a compact statline entry from the new date-keyed format.
 * entry = { b: { ab, h, ... }, pos, t }
 */
function parseFlatEntry(entry: any, mlbId: string, gamePk: string): any {
  if (!entry?.b) return null;
  const b = entry.b;
  const stats: any = {
    mlbId, gamePk,
    g: b.g || 0, ab: b.ab || 0, h: b.h || 0,
    '2b': b['2b'] || 0, '3b': b['3b'] || 0, hr: b.hr || 0,
    bb: b.bb || 0, ibb: b.ibb || 0, hbp: b.hbp || 0,
    sb: b.sb || 0, cs: b.cs || 0, sac: b.sac || 0,
    sf: b.sf || 0, po: b.po || 0, e: b.e || 0, pb: b.pb || 0,
  };
  stats.abl_points = calculateAblPoints(stats);
  return stats;
}

// === STAT FETCHING ===

/**
 * Fetch from the `statlines` collection and attach dailyStats to each roster player.
 * Supports both the new compact date-keyed format and the legacy per-game-doc format.
 * Multiple statlines on the same day (doubleheaders) are summed.
 *
 * If teamGameStates is provided, also attaches mlbGameState to each player so the
 * activation algorithm can distinguish "hasn't played yet" from "finished playing".
 */
export async function getStatsForRoster(
  db: Db,
  roster: any[],
  gameDate: Date,
  teamGameStates?: Map<string, string>,
): Promise<any[]> {
  const ablDate = deriveAblDate(gameDate);

  // New compact format: single doc per date keyed by _id = ablDate
  const dateDoc = await db.collection('statlines').findOne({ _id: ablDate as any });

  if (dateDoc?.p) {
    const entries = dateDoc.p as Record<string, any>;
    return roster.map(player => {
      const mlbID = String(player.player?.mlbID || player.mlbID || '');
      const teamAbbr: string = player.player?.team || '';
      const mlbGameState = teamGameStates?.get(teamAbbr) ?? 'Final';
      const prefix = mlbID + '_';
      const playerStats = Object.entries(entries)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, entry]) => parseFlatEntry(entry, mlbID, key.slice(prefix.length)))
        .filter(Boolean)
        .reduce((total: any, rec: any) => {
          for (const f of STAT_FIELDS) total[f] = (total[f] || 0) + (rec[f] || 0);
          total.abl_points = calculateAblPoints(total);
          return total;
        }, emptyStats());
      return { ...player, mlbGameState, dailyStats: playerStats };
    });
  }

  // Legacy format: one doc per player-game (backward compat during/after migration)
  const statlineDocs = await db.collection('statlines').aggregate([
    { $match: { ablDate } },
    { $addFields: { stats: { $ifNull: ['$updatedStats', '$stats'] } } },
  ]).toArray();

  return roster.map(player => {
    const mlbID = player.player?.mlbID || player.mlbID;
    const teamAbbr: string = player.player?.team || '';
    const mlbGameState = teamGameStates?.get(teamAbbr) ?? 'Final';
    const playerStats = statlineDocs
      .filter(sl => String(sl.mlbId) === String(mlbID))
      .map(parseDailyStats)
      .filter(Boolean)
      .reduce((total: any, rec: any) => {
        for (const f of STAT_FIELDS) total[f] = (total[f] || 0) + (rec[f] || 0);
        total.abl_points = calculateAblPoints(total);
        return total;
      }, emptyStats());
    return { ...player, mlbGameState, dailyStats: playerStats };
  });
}

// === ACTIVATION ALGORITHM ===

/**
 * Two-pass ABL activation algorithm.
 *
 * Pass 1 (starterOnly=true): For each non-DH slot in ABL_STARTERS, activate the first
 *   bench player at that lineupPosition who has g > 0.
 *
 * Pass 2 (starterOnly=false): For each slot (including DH), keep adding eligible bench
 *   players until that slot has ≥ 2 APAs. If no bench players remain:
 *   - posGs > 0 → supplement with 0-for-(2-posPAs)
 *   - posGs == 0 → supplement with 0-for-4
 *
 * When isFinal=false (live/in-progress day), supplementation is suppressed whenever any
 * remaining eligible bench player has an MLB game that is still Preview or Live. In that
 * case we stop padding and wait — the slot will be completed on a later refresh once their
 * game has finished.
 *
 * Returns the full roster (active + bench + any supplementals) with:
 *   ablstatus, playedPosition, ablRosterPosition, lineupOrder set.
 */
export function activateRoster(roster: any[], isFinal: boolean = true): any[] {
  const lineup: any[] = roster.map(p => ({
    ...p,
    ablstatus: 'bench' as string,
    playedPosition: null,
    ablRosterPosition: null,
    lineupOrder: null,
  }));

  let orderCounter = 0;

  const active = () => lineup.filter(p => p.ablstatus === 'active');
  const bench  = () => lineup.filter(p => p.ablstatus !== 'active');

  function benchWithStats() {
    return bench().filter(p => (p.dailyStats?.g || 0) > 0);
  }

  function activatePlayer(p: any, pos: string, rosterPos: number, playedType: string) {
    p.ablstatus = 'active';
    p.playedPosition = pos;
    p.ablRosterPosition = rosterPos;
    p.lineupOrder = ++orderCounter;
    p.ablPlayedType = playedType;
  }

  function positionPAs(rosterPos: number): number {
    return active()
      .filter(p => p.ablRosterPosition === rosterPos)
      .reduce((sum, p) => sum + calcAPA(p.dailyStats), 0);
  }

  function positionGs(rosterPos: number): number {
    return active()
      .filter(p => p.ablRosterPosition === rosterPos)
      .reduce((sum, p) => sum + (p.dailyStats?.g || 0), 0);
  }

  /** Returns true if a player's MLB game is still in progress or not yet started. */
  function isPending(p: any): boolean {
    const state = p.mlbGameState as string | undefined;
    return state === 'Preview' || state === 'Live';
  }

  function startNextPlayer(pos: string, rosterPos: number, starterOnly: boolean) {
    let posPAs = positionPAs(rosterPos);
    let posGs  = positionGs(rosterPos);

    // If any already-active player at this slot has a pending game (Preview/Live), the slot
    // is being held by that player — stop here without adding subs or supplements.
    // This happens in Pass 2 when Pass 1 placed a pending player to hold the slot.
    if (!isFinal && active().filter(p => p.ablRosterPosition === rosterPos).some(isPending)) {
      return;
    }

    // possibles: bench players eligible for this slot, sorted by rosterOrder ascending
    const possibles = bench()
      .filter(p => canPlaySlot(p.lineupPosition, pos))
      .sort((a, b) => (a.rosterOrder ?? 0) - (b.rosterOrder ?? 0));
    let playedType = (pos === 'XTRA') ? 'XTRA' : (posGs === 0 ? 'STARTER' : 'SUB');

    while (starterOnly ? posGs < 1 : posPAs < 2) {
      if (possibles.length > 0) {
        const nextPlyr = possibles.shift()!;
        if ((nextPlyr.dailyStats?.g || 0) > 0) {
          activatePlayer(nextPlyr, pos, rosterPos, playedType);
          posPAs += calcAPA(nextPlyr.dailyStats);
          posGs  += nextPlyr.dailyStats?.g || 0;
          if (playedType === 'STARTER') playedType = 'SUB';
        } else if (!isFinal && isPending(nextPlyr)) {
          // Game hasn't started yet — activate this player to hold the slot and stop.
          // A later refresh will fill in their real stats once the game begins/ends.
          activatePlayer(nextPlyr, pos, rosterPos, playedType);
          break;
        }
        // g=0 and not pending (game is over, player didn't appear): skip and continue
      } else {
        // No eligible bench players remain — check if any were skipped due to pending games.
        // If so, and this is a live (non-final) calculation, stop here rather than inserting
        // a dummy supplement line. The slot will be completed on a later refresh.
        if (!isFinal) {
          const hasPendingEligible = bench()
            .filter(p => canPlaySlot(p.lineupPosition, pos))
            .some(p => isPending(p));
          if (hasPendingEligible) break;
        }

        // Insert supplemental
        if (posGs > 0) {
          // At least one player played: supplement to reach 2 APAs
          lineup.push({
            player: { name: 'supp' },
            ablstatus: 'active',
            playedPosition: pos,
            ablRosterPosition: rosterPos,
            lineupOrder: ++orderCounter,
            ablPlayedType: playedType,
            lineupPosition: pos,
            dailyStats: { ...emptyStats(), g: 1, ab: Math.max(0, 2 - posPAs) },
          });
          posPAs = 2;
        } else {
          // Nobody played at this position: 0-for-4
          lineup.push({
            player: { name: 'four' },
            ablstatus: 'active',
            playedPosition: pos,
            ablRosterPosition: rosterPos,
            lineupOrder: ++orderCounter,
            ablPlayedType: playedType,
            lineupPosition: pos,
            dailyStats: { ...emptyStats(), g: 1, ab: 4 },
          });
          posPAs = 4;
        }
        posGs += 1;
        break; // supplemental added — slot is done
      }
    }
  }

  // --- Pass 1: one starter per non-DH position ---
  for (let i = 0; i < ABL_STARTERS.length; i++) {
    const pos = ABL_STARTERS[i];
    if (pos !== 'DH') startNextPlayer(pos, i, true);
  }

  // --- Pass 2: fill all slots to 2 APAs (including DH) ---
  for (let i = 0; i < ABL_STARTERS.length; i++) {
    startNextPlayer(ABL_STARTERS[i], i, false);
  }

  lineup.sort((a, b) => (a.lineupOrder ?? Infinity) - (b.lineupOrder ?? Infinity));
  return lineup;
}

// === SCORE CALCULATION ===

/**
 * Calculate team score from an activated roster.
 *
 * Score formula (per the commissioner):
 *   abl_runs = (Σ abl_points / Σ ab) - 4.5 + (opp_e × 0.5) + (opp_pb × 0.2) + (0.5 if home)
 *
 * Errors/PBs from DH or XTRA players are excluded from the team error/PB totals.
 */
export function calculateTeamScore(
  activePlayers: any[],
  isHome: boolean,
  oppErrors: number,
  oppPBs: number,
): { abl_runs: number; abl_points: number; ab: number; h: number; '2b': number; '3b': number; hr: number; bb: number; hbp: number; sac: number; sf: number; sb: number; cs: number; e: number; pb: number; opp_e: number; opp_pb: number } {
  let abl_points = 0, ab = 0, h = 0, doubles = 0, triples = 0, hr = 0, bb = 0, hbp = 0, sac = 0, sf = 0, sb = 0, cs = 0, e = 0, pb = 0;

  for (const p of activePlayers) {
    const ds = p.dailyStats || {};
    abl_points += ds.abl_points || 0;
    ab  += ds.ab  || 0;
    h   += ds.h   || 0;
    doubles += ds['2b'] || 0;
    triples += ds['3b'] || 0;
    hr  += ds.hr  || 0;
    bb  += ds.bb  || 0;
    hbp += ds.hbp || 0;
    sac += ds.sac || 0;
    sf  += ds.sf  || 0;
    sb  += ds.sb  || 0;
    cs  += ds.cs  || 0;

    // DH and XTRA player errors/PBs do NOT count toward team totals
    if (p.playedPosition !== 'DH' && p.playedPosition !== 'XTRA') {
      e  += ds.e  || 0;
      pb += ds.pb || 0;
    }
  }

  const abl_runs = ab > 0
    ? abl_points / ab - 4.5 + oppErrors * 0.5 + oppPBs * 0.2 + (isHome ? 0.5 : 0)
    : (isHome ? 0.5 : 0) - 4.5;

  return { abl_runs, abl_points, ab, h, '2b': doubles, '3b': triples, hr, bb, hbp, sac, sf, sb, cs, e, pb, opp_e: oppErrors, opp_pb: oppPBs };
}

// === LIVE GAME RESULT (FORWARD USE) ===

/**
 * Calculate a game result from scratch for a live/new game.
 *
 * Steps:
 *  1. Fetch daily stats from the `statlines` collection for the game date
 *  2. Run the two-pass activation algorithm on each roster
 *  3. Add XTRA players while |home - away| ≤ 0.5 and bench players with stats remain
 *  4. Return full result with regulation + final scores
 */
export async function calculateGameResultLive(
  db: Db,
  gameId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeRosterRaw: any[],
  awayRosterRaw: any[],
  gameDate: Date,
  isFinal: boolean = true,
) {
  // Build a map of MLB team abbreviation → abstractGameState for today's schedule.
  // When isFinal=false (live day), fetch fresh game states directly from the MLB Stats API
  // using ?hydrate=team so we get the team abbreviation field. The mlbgameschemas collection
  // only syncs once in the morning and its team documents lack the abbreviation field, so we
  // bypass it here to ensure accurate live state.
  const ablDate = deriveAblDate(gameDate);
  const teamGameStates = new Map<string, string>();
  if (!isFinal) {
    try {
      const scheduleUrl =
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${ablDate}&gameType=R&hydrate=team`;
      const resp = await fetch(scheduleUrl, { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        for (const dateEntry of (data.dates ?? []) as any[]) {
          for (const game of (dateEntry.games ?? []) as any[]) {
            const state: string = game.status?.abstractGameState ?? 'Final';
            const away: string = game.teams?.away?.team?.abbreviation ?? '';
            const home: string = game.teams?.home?.team?.abbreviation ?? '';
            if (away) teamGameStates.set(away, state);
            if (home) teamGameStates.set(home, state);
          }
        }
      }
    } catch {
      // Network failure — leave map empty. Supplements may be added for players on
      // pending-game teams but that is the safe fallback vs crashing the calculation.
    }
  }

  // 1. Fetch stats (attaches mlbGameState to each player)
  const [homeWithStats, awayWithStats] = await Promise.all([
    getStatsForRoster(db, homeRosterRaw, gameDate, teamGameStates),
    getStatsForRoster(db, awayRosterRaw, gameDate, teamGameStates),
  ]);

  // 2. Activate rosters — pass isFinal so supplementation is suppressed for pending games
  let homeLineup = activateRoster(homeWithStats, isFinal);
  let awayLineup = activateRoster(awayWithStats, isFinal);

  function computeScores(homeActive: any[], awayActive: any[], includeXtra: boolean) {
    const hPlayers = includeXtra ? homeActive : homeActive.filter(p => p.playedPosition !== 'XTRA');
    const aPlayers = includeXtra ? awayActive : awayActive.filter(p => p.playedPosition !== 'XTRA');

    // Errors/PBs come from the opponent's active (non-DH/non-XTRA) players
    const homeOppE  = aPlayers.filter(p => p.playedPosition !== 'DH' && p.playedPosition !== 'XTRA').reduce((s, p) => s + (p.dailyStats?.e  || 0), 0);
    const homeOppPB = aPlayers.filter(p => p.playedPosition !== 'DH' && p.playedPosition !== 'XTRA').reduce((s, p) => s + (p.dailyStats?.pb || 0), 0);
    const awayOppE  = hPlayers.filter(p => p.playedPosition !== 'DH' && p.playedPosition !== 'XTRA').reduce((s, p) => s + (p.dailyStats?.e  || 0), 0);
    const awayOppPB = hPlayers.filter(p => p.playedPosition !== 'DH' && p.playedPosition !== 'XTRA').reduce((s, p) => s + (p.dailyStats?.pb || 0), 0);

    const home = calculateTeamScore(hPlayers, true,  homeOppE,  homeOppPB);
    const away = calculateTeamScore(aPlayers, false, awayOppE,  awayOppPB);
    return { home, away };
  }

  // 3. XTRA loop — add XTRA players while scores are tied (≤ 0.5 margin)
  function benchWithStats(lineup: any[]) {
    return lineup.filter(p => p.ablstatus !== 'active' && (p.dailyStats?.g || 0) > 0);
  }
  function nextRosterPos(lineup: any[]) {
    return lineup.filter(p => p.ablstatus === 'active').reduce((max, p) => Math.max(p.ablRosterPosition ?? 0, max), 0) + 1;
  }

  let finalScores = computeScores(
    homeLineup.filter(p => p.ablstatus === 'active'),
    awayLineup.filter(p => p.ablstatus === 'active'),
    true,
  );

  while (
    Math.abs(finalScores.home.abl_runs - finalScores.away.abl_runs) <= 0.5 &&
    (benchWithStats(homeLineup).length + benchWithStats(awayLineup).length > 0)
  ) {
    homeLineup = activateRosterXtra(homeLineup, nextRosterPos(homeLineup), isFinal);
    awayLineup = activateRosterXtra(awayLineup, nextRosterPos(awayLineup), isFinal);

    finalScores = computeScores(
      homeLineup.filter(p => p.ablstatus === 'active'),
      awayLineup.filter(p => p.ablstatus === 'active'),
      true,
    );
  }

  const regulationScores = computeScores(
    homeLineup.filter(p => p.ablstatus === 'active'),
    awayLineup.filter(p => p.ablstatus === 'active'),
    false,
  );

  homeLineup.sort((a, b) => (a.lineupOrder ?? Infinity) - (b.lineupOrder ?? Infinity));
  awayLineup.sort((a, b) => (a.lineupOrder ?? Infinity) - (b.lineupOrder ?? Infinity));

  const winner = finalScores.home.abl_runs > finalScores.away.abl_runs ? homeTeamId : awayTeamId;
  const loser  = finalScores.home.abl_runs > finalScores.away.abl_runs ? awayTeamId : homeTeamId;

  /**
   * Keep only the fields needed from each player entry:
   *   player: { _id, name, eligible }  — drop seasonStats, team, mlbID, status, etc.
   *   dailyStats, lineupPosition, playedPosition, ablstatus, ablRosterPosition, lineupOrder, ablPlayedType
   * This keeps game docs small. The full player record lives in the players collection.
   */
  function slimLineup(lineup: any[]) {
    return lineup.map((p) => ({
      player: p.player
        ? {
            _id: p.player._id,
            name: p.player.name,
            eligible: p.player.eligible,
            team: p.player.team,
          }
        : p.player,
      lineupPosition: p.lineupPosition,
      rosterOrder: p.rosterOrder,
      ablstatus: p.ablstatus,
      playedPosition: p.playedPosition,
      ablRosterPosition: p.ablRosterPosition,
      lineupOrder: p.lineupOrder,
      ablPlayedType: p.ablPlayedType,
      dailyStats: p.dailyStats,
    }));
  }

  return {
    scores: [
      {
        team: new ObjectId(homeTeamId),
        location: 'H',
        regulation: regulationScores.home,
        final: finalScores.home,
        players: slimLineup(homeLineup),
      },
      {
        team: new ObjectId(awayTeamId),
        location: 'A',
        regulation: regulationScores.away,
        final: finalScores.away,
        players: slimLineup(awayLineup),
      },
    ],
    winner: new ObjectId(winner),
    loser: new ObjectId(loser),
    calculatedAt: new Date(),
  };
}

/**
 * Add one XTRA activation step to an already-activated lineup.
 * Used in the XTRA tie-breaking loop.
 */
export function activateRosterXtra(lineup: any[], rosterPos: number, isFinal: boolean = true): any[] {
  let orderCounter = lineup.filter(p => p.ablstatus === 'active').length;
  const bench = lineup.filter(p => p.ablstatus !== 'active');
  const possibles = bench.filter(p => canPlaySlot(p.lineupPosition, 'XTRA'));

  let posPAs = 0;
  let posGs  = 0;

  while (posPAs < 2) {
    if (possibles.length > 0) {
      const nextPlyr = possibles.shift()!;
      if ((nextPlyr.dailyStats?.g || 0) > 0) {
        const idx = lineup.indexOf(nextPlyr);
        if (idx >= 0) {
          lineup[idx].ablstatus = 'active';
          lineup[idx].playedPosition = 'XTRA';
          lineup[idx].ablRosterPosition = rosterPos;
          lineup[idx].lineupOrder = ++orderCounter;
          lineup[idx].ablPlayedType = 'XTRA';
        }
        posPAs += calcAPA(nextPlyr.dailyStats);
        posGs  += nextPlyr.dailyStats?.g || 0;
      }
    } else {
      // Suppress supplemental if any remaining eligible player has a pending game
      if (!isFinal) {
        const hasPendingEligible = lineup
          .filter(p => p.ablstatus !== 'active' && canPlaySlot(p.lineupPosition, 'XTRA'))
          .some(p => {
            const state = p.mlbGameState as string | undefined;
            return state === 'Preview' || state === 'Live';
          });
        if (hasPendingEligible) break;
      }
      if (posGs > 0) {
        lineup.push({
          player: { name: 'supp' },
          ablstatus: 'active',
          playedPosition: 'XTRA',
          ablRosterPosition: rosterPos,
          lineupOrder: ++orderCounter,
          ablPlayedType: 'XTRA',
          lineupPosition: 'XTRA',
          dailyStats: { ...emptyStats(), g: 1, ab: Math.max(0, 2 - posPAs) },
        });
      }
      break;
    }
  }
  return lineup;
}

// === LEGACY RECALCULATION (uses pre-stored playedPosition + abl_points) ===

/**
 * Calculate final game result from rosters and player stats
 * Returns result object with scores, winner, loser
 */
export async function calculateGameResult(
  db: Db,
  gameId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeTeamRoster: any[],
  awayTeamRoster: any[],
  options?: {
    homeOpponentErrors?: number;
    awayOpponentErrors?: number;
  }
) {
  try {
    // Calculate home team score using dailyStats from roster
    const homeScores = homeTeamRoster.map((rosterItem: any) => {
      // Use pre-calculated abl_points from dailyStats (legacy data has this)
      const dailyStats = rosterItem.dailyStats;
      
      // Extract pre-calculated points (legacy stores it in abl_points or abl_score.abl_points)
      const points = dailyStats?.abl_points 
        || dailyStats?.abl_score?.abl_points 
        || (dailyStats ? calculateAblPoints(dailyStats) : 0);
      const ab = dailyStats?.ab || 0;

      return {
        player: {
          _id: rosterItem.player?._id || rosterItem._id,
          name: rosterItem.player?.name || rosterItem.name,
          mlbID: rosterItem.player?.mlbID,
          team: rosterItem.player?.team
        },
        lineupOrder: rosterItem.lineupOrder,
        lineupPosition: rosterItem.lineupPosition,
        playedPosition: rosterItem.playedPosition,
        points: points,
        ab: ab,
        score: ab > 0 ? (points / ab - 4.5) : 0,
        dailyStats: dailyStats || {}
      };
    });

    // Calculate away team score using dailyStats from roster
    const awayScores = awayTeamRoster.map((rosterItem: any) => {
      // Use pre-calculated abl_points from dailyStats (legacy data has this)
      const dailyStats = rosterItem.dailyStats;
      
      // Extract pre-calculated points (legacy stores it in abl_points or abl_score.abl_points)
      const points = dailyStats?.abl_points 
        || dailyStats?.abl_score?.abl_points 
        || (dailyStats ? calculateAblPoints(dailyStats) : 0);
      const ab = dailyStats?.ab || 0;

      return {
        player: {
          _id: rosterItem.player?._id || rosterItem._id,
          name: rosterItem.player?.name || rosterItem.name,
          mlbID: rosterItem.player?.mlbID,
          team: rosterItem.player?.team
        },
        lineupOrder: rosterItem.lineupOrder,
        lineupPosition: rosterItem.lineupPosition,
        playedPosition: rosterItem.playedPosition,
        points: points,
        ab: ab,
        score: ab > 0 ? (points / ab - 4.5) : 0,
        dailyStats: dailyStats || {}
      };
    });

    // Sum team totals (only counting players who were actually activated into game slots)
    // Legacy Angular behavior keys off playedPosition, not lineupPosition.
    const isCountedPlayer = (player: any) => {
      const playedPosition = player.playedPosition;
      if (!playedPosition) return false;
      if (playedPosition === 'INJ') return false;
      return true;
    };

    const homeRosteredPlayers = homeScores.filter((s: any) => isCountedPlayer(s));
    const awayRosteredPlayers = awayScores.filter((s: any) => isCountedPlayer(s));

    const homeTotalPoints = homeRosteredPlayers.reduce((sum: number, s: any) => sum + s.points, 0);
    const homeTotalAB = homeRosteredPlayers.reduce((sum: number, s: any) => sum + s.ab, 0);
    
    const awayTotalPoints = awayRosteredPlayers.reduce((sum: number, s: any) => sum + s.points, 0);
    const awayTotalAB = awayRosteredPlayers.reduce((sum: number, s: any) => sum + s.ab, 0);

    // Sum hitting stats for each team
    const sumStat = (players: any[], field: string) =>
      players.reduce((sum: number, s: any) => sum + (s.dailyStats?.[field] || 0), 0);

    const homeTotalH   = sumStat(homeRosteredPlayers, 'h');
    const homeTotal2B  = sumStat(homeRosteredPlayers, '2b');
    const homeTotal3B  = sumStat(homeRosteredPlayers, '3b');
    const homeTotalHR  = sumStat(homeRosteredPlayers, 'hr');
    const homeTotalBB  = sumStat(homeRosteredPlayers, 'bb');
    const homeTotalHBP = sumStat(homeRosteredPlayers, 'hbp');
    const homeTotalSAC = sumStat(homeRosteredPlayers, 'sac');
    const homeTotalSF  = sumStat(homeRosteredPlayers, 'sf');
    const homeTotalSB  = sumStat(homeRosteredPlayers, 'sb');
    const homeTotalCS  = sumStat(homeRosteredPlayers, 'cs');

    const awayTotalH   = sumStat(awayRosteredPlayers, 'h');
    const awayTotal2B  = sumStat(awayRosteredPlayers, '2b');
    const awayTotal3B  = sumStat(awayRosteredPlayers, '3b');
    const awayTotalHR  = sumStat(awayRosteredPlayers, 'hr');
    const awayTotalBB  = sumStat(awayRosteredPlayers, 'bb');
    const awayTotalHBP = sumStat(awayRosteredPlayers, 'hbp');
    const awayTotalSAC = sumStat(awayRosteredPlayers, 'sac');
    const awayTotalSF  = sumStat(awayRosteredPlayers, 'sf');
    const awayTotalSB  = sumStat(awayRosteredPlayers, 'sb');
    const awayTotalCS  = sumStat(awayRosteredPlayers, 'cs');

    // Count opponent errors
    const computedHomeOpponentErrors = awayRosteredPlayers.reduce((sum: number, s: any) =>
      sum + (s.dailyStats?.e || 0), 0);
    const computedAwayOpponentErrors = homeRosteredPlayers.reduce((sum: number, s: any) =>
      sum + (s.dailyStats?.e || 0), 0);

    const homeOpponentErrors =
      typeof options?.homeOpponentErrors === 'number'
        ? options.homeOpponentErrors
        : computedHomeOpponentErrors;
    const awayOpponentErrors =
      typeof options?.awayOpponentErrors === 'number'
        ? options.awayOpponentErrors
        : computedAwayOpponentErrors;

    // Calculate final team scores
    // Formula: (abl_points / at_bats) - 4.5 + (opponent_errors × 0.5) + (0.5 if home)
    const homeBaseScore = homeTotalAB > 0 ? (homeTotalPoints / homeTotalAB - 4.5) : 0;
    const awayBaseScore = awayTotalAB > 0 ? (awayTotalPoints / awayTotalAB - 4.5) : 0;
    
    const homeTeamFinalScore = homeBaseScore + (homeOpponentErrors * 0.5) + 0.5;
    const awayTeamFinalScore = awayBaseScore + (awayOpponentErrors * 0.5);

    // Determine winner
    const winner = homeTeamFinalScore > awayTeamFinalScore ? homeTeamId : awayTeamId;
    const loser = homeTeamFinalScore > awayTeamFinalScore ? awayTeamId : homeTeamId;

    return {
      scores: [
        {
          team: new ObjectId(homeTeamId),
          final: homeTeamFinalScore,
          regulation: { 
            score: homeTeamFinalScore,
            abl_runs: homeTeamFinalScore,
            abl_points: homeTotalPoints,
            ab: homeTotalAB,
            h: homeTotalH,
            '2b': homeTotal2B,
            '3b': homeTotal3B,
            hr: homeTotalHR,
            bb: homeTotalBB,
            hbp: homeTotalHBP,
            sac: homeTotalSAC,
            sf: homeTotalSF,
            sb: homeTotalSB,
            cs: homeTotalCS,
            opp_e: homeOpponentErrors
          },
          players: homeScores
        },
        {
          team: new ObjectId(awayTeamId),
          final: awayTeamFinalScore,
          regulation: { 
            score: awayTeamFinalScore,
            abl_runs: awayTeamFinalScore,
            abl_points: awayTotalPoints,
            ab: awayTotalAB,
            h: awayTotalH,
            '2b': awayTotal2B,
            '3b': awayTotal3B,
            hr: awayTotalHR,
            bb: awayTotalBB,
            hbp: awayTotalHBP,
            sac: awayTotalSAC,
            sf: awayTotalSF,
            sb: awayTotalSB,
            cs: awayTotalCS,
            opp_e: awayOpponentErrors
          },
          players: awayScores
        }
      ],
      winner: new ObjectId(winner),
      loser: new ObjectId(loser),
      calculatedAt: new Date()
    };
  } catch (error) {
    console.error('Error calculating game result:', error);
    throw error;
  }
}
