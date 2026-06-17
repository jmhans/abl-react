import { Db, ObjectId } from 'mongodb';
import { deriveAblDate } from '@/app/lib/abl-date';
import { calculateAndStoreLiveGameResult } from '@/app/lib/game-calculation-service';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

function formatDateYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function minifyStatsObject(input: Record<string, any> = {}) {
  return Object.keys(input).reduce((acc: Record<string, number>, key) => {
    const value = toNumber(input[key]);
    if (value !== 0) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

type PlayerDateAccumulator = {
  gamesPlayed: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  baseOnBalls: number;
  intentionalWalks: number;
  hitByPitch: number;
  stolenBases: number;
  caughtStealing: number;
  sacBunts: number;
  sacFlies: number;
  pickoffs: number;
  errors: number;
  passedBall: number;
  firstEventAt?: Date;
};

function emptyAccumulator(): PlayerDateAccumulator {
  return {
    gamesPlayed: 0,
    atBats: 0,
    hits: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    baseOnBalls: 0,
    intentionalWalks: 0,
    hitByPitch: 0,
    stolenBases: 0,
    caughtStealing: 0,
    sacBunts: 0,
    sacFlies: 0,
    pickoffs: 0,
    errors: 0,
    passedBall: 0,
  };
}

function addAccumulatorDate(acc: PlayerDateAccumulator, eventDate: Date) {
  if (!acc.firstEventAt || eventDate.getTime() < acc.firstEventAt.getTime()) {
    acc.firstEventAt = eventDate;
  }
}

function playerDateKey(mlbId: string, ablDate: string): string {
  return `${mlbId}|${ablDate}`;
}

function shouldUsePlayByPlaySplit(game: any): boolean {
  // Use play-by-play only for the continuation entry (has resumedFrom, meaning this IS the
  // resumed game on the new date). The original suspended-game entry has resumeDate (forward-
  // looking) but should just use the boxscore since the game hasn't finished yet.
  return Boolean(game?.resumedFrom);
}

function isCurrentlySuspended(game: any): boolean {
  return (
    game?.status?.codedGameState === 'U' ||
    String(game?.status?.detailedState || '').toLowerCase().startsWith('suspended')
  );
}

function toBoxscoreStatsFromAccumulator(acc: PlayerDateAccumulator) {
  return {
    batting: {
      gamesPlayed: acc.gamesPlayed,
      atBats: acc.atBats,
      hits: acc.hits,
      doubles: acc.doubles,
      triples: acc.triples,
      homeRuns: acc.homeRuns,
      baseOnBalls: acc.baseOnBalls,
      intentionalWalks: acc.intentionalWalks,
      hitByPitch: acc.hitByPitch,
      stolenBases: acc.stolenBases,
      caughtStealing: acc.caughtStealing,
      sacBunts: acc.sacBunts,
      sacFlies: acc.sacFlies,
      pickoffs: acc.pickoffs,
    },
    fielding: {
      errors: acc.errors,
      passedBall: acc.passedBall,
    },
  };
}

function bumpPlateAppearanceFromEventType(acc: PlayerDateAccumulator, eventType: string | undefined) {
  const event = String(eventType || '').toLowerCase();

  switch (event) {
    case 'single':
      acc.atBats += 1;
      acc.hits += 1;
      acc.gamesPlayed = 1;
      return;
    case 'double':
      acc.atBats += 1;
      acc.hits += 1;
      acc.doubles += 1;
      acc.gamesPlayed = 1;
      return;
    case 'triple':
      acc.atBats += 1;
      acc.hits += 1;
      acc.triples += 1;
      acc.gamesPlayed = 1;
      return;
    case 'home_run':
      acc.atBats += 1;
      acc.hits += 1;
      acc.homeRuns += 1;
      acc.gamesPlayed = 1;
      return;
    case 'walk':
      acc.baseOnBalls += 1;
      acc.gamesPlayed = 1;
      return;
    case 'intent_walk':
    case 'intentional_walk':
      acc.baseOnBalls += 1;
      acc.intentionalWalks += 1;
      acc.gamesPlayed = 1;
      return;
    case 'hit_by_pitch':
      acc.hitByPitch += 1;
      acc.gamesPlayed = 1;
      return;
    case 'sac_fly':
      acc.sacFlies += 1;
      acc.gamesPlayed = 1;
      return;
    case 'sac_bunt':
      acc.sacBunts += 1;
      acc.gamesPlayed = 1;
      return;
    case 'field_out':
    case 'force_out':
    case 'grounded_into_double_play':
    case 'double_play':
    case 'triple_play':
    case 'fielders_choice':
    case 'fielders_choice_out':
    case 'strikeout':
    case 'strikeout_double_play':
    case 'lineout':
    case 'flyout':
    case 'popup':
    case 'groundout':
    case 'field_error':
      acc.atBats += 1;
      acc.gamesPlayed = 1;
      return;
    default:
      return;
  }
}

function shortenBoxscoreStats(stats: any) {
  const batting = minifyStatsObject(stats?.batting || {});
  return {
    batting,
    fielding: {
      e: toNumber(stats?.fielding?.errors),
      pb: toNumber(stats?.fielding?.passedBall),
    },
  };
}

// Only keep the batting fields needed by calculateAblScore / calculateDraftAblScore.
// Drops pitching and unused batting fields from the full MLB seasonStats blob.
const SEASON_STAT_BATTING_FIELDS = [
  'gamesPlayed', 'atBats', 'hits', 'doubles', 'triples', 'homeRuns',
  'baseOnBalls', 'hitByPitch', 'stolenBases', 'caughtStealing',
  'pickoffs', 'sacBunts', 'sacFlies',
] as const;

function slimSeasonStats(seasonStats: any): { batting: Record<string, number>; fielding: { errors: number } } {
  if (!seasonStats?.batting) return { batting: {}, fielding: { errors: 0 } };
  const batting: Record<string, number> = {};
  for (const field of SEASON_STAT_BATTING_FIELDS) {
    const v = toNumber(seasonStats.batting[field]);
    if (v !== 0) batting[field] = v;
  }
  const errors = seasonStats.fielding ? toNumber(seasonStats.fielding.errors) : 0;
  return { batting, fielding: { errors } };
}

// Maps long MLB batting field names → short field names used in compact statline storage
const BATTING_SHORT: Record<string, string> = {
  gamesPlayed: 'g', atBats: 'ab', hits: 'h', doubles: '2b', triples: '3b',
  homeRuns: 'hr', baseOnBalls: 'bb', intentionalWalks: 'ibb', hitByPitch: 'hbp',
  stolenBases: 'sb', caughtStealing: 'cs', sacBunts: 'sac', sacFlies: 'sf',
  pickoffs: 'po',
};

/**
 * Convert a statlineDoc (with nested batting/fielding) into the compact
 * format stored in the date-keyed collection: { b, pos, t }
 * Zero values are omitted to save space.
 */
function encodeStatlineEntry(statlineDoc: any): Record<string, any> {
  const s = statlineDoc.stats;
  const b: Record<string, number> = {};
  for (const [long, short] of Object.entries(BATTING_SHORT)) {
    const v = toNumber(s?.batting?.[long]);
    if (v !== 0) b[short] = v;
  }
  const e = toNumber(s?.fielding?.e);
  const pb = toNumber(s?.fielding?.pb);
  if (e) b.e = e;
  if (pb) b.pb = pb;
  const entry: Record<string, any> = { b };
  if (statlineDoc.positions?.length) entry.pos = statlineDoc.positions;
  if (statlineDoc.statlineType) entry.t = statlineDoc.statlineType;
  return entry;
}

function hasAnyStats(statlineDoc: Record<string, any>): boolean {
  return (
    Object.keys(statlineDoc.stats.batting).length > 0 ||
    statlineDoc.stats.fielding.e > 0 ||
    statlineDoc.stats.fielding.pb > 0
  );
}

function isPositionPlayer(boxscorePlayer: any): boolean {
  const positionAbbr = boxscorePlayer?.position?.abbreviation;
  if (!positionAbbr) return false;
  if (positionAbbr !== 'P') return true;
  // Two-way players (e.g. Ohtani) are listed as 'P' but also bat —
  // include any pitcher who actually has batting stats.
  const batting = boxscorePlayer?.stats?.batting || {};
  return Object.keys(batting).some((k) => {
    const v = Number(batting[k]);
    return Number.isFinite(v) && v !== 0;
  });
}

async function fetchJson(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function extractBoxscorePlayerEntries(boxscore: any) {
  const awayAbbr = boxscore?.teams?.away?.team?.abbreviation || '';
  const homeAbbr = boxscore?.teams?.home?.team?.abbreviation || '';
  const awayPlayers = Object.values(boxscore?.teams?.away?.players || {}).map((player: any) => ({ player, teamAbbr: awayAbbr }));
  const homePlayers = Object.values(boxscore?.teams?.home?.players || {}).map((player: any) => ({ player, teamAbbr: homeAbbr }));
  return [...awayPlayers, ...homePlayers];
}

function buildPlayerAndStatlineDocs(game: any, teamAbbr: string, boxscorePlayer: any) {
  const mlbID = String(boxscorePlayer?.person?.id || '');
  if (!mlbID || !isPositionPlayer(boxscorePlayer)) return null;

  const shortPositions = Array.isArray(boxscorePlayer?.allPositions)
    ? boxscorePlayer.allPositions
        .map((p: any) => p?.abbreviation)
        .filter(Boolean)
    : [];

  const gameDate = new Date(game.gameDate);

  // Only include season stats if the boxscore provides non-empty batting data.
  // An empty seasonStats (null or all-zero) must NOT overwrite existing player
  // stats — this can happen when the MLB API hasn't fully populated seasonStats
  // yet (e.g. season debut, recently called-up players, or mid-game snapshots).
  const newStats = slimSeasonStats(boxscorePlayer?.seasonStats);
  const hasSeasonStats = Object.keys(newStats.batting).length > 0;

  const playerDoc: Record<string, any> = {
    name: boxscorePlayer?.person?.fullName || '',
    team: teamAbbr,
    status: boxscorePlayer?.status?.description || '',
    lastStatUpdate: gameDate,
    ...(hasSeasonStats ? { stats: newStats } : {}),
  };

  const statlineDoc = {
    mlbId: mlbID,
    gameDate,
    gamePk: String(game.gamePk),
    stats: shortenBoxscoreStats(boxscorePlayer?.stats || {}),
    positions: shortPositions,
    statlineType: game?.status?.detailedState,
    ablDate: deriveAblDate(gameDate),
  };

  return { mlbID, playerDoc, statlineDoc };
}

async function processGameBoxscore(db: Db, game: any) {
  const boxscoreUrl = `${MLB_API_BASE}/game/${game.gamePk}/boxscore`;
  const boxscore = await fetchJson(boxscoreUrl);

  const allEntries = extractBoxscorePlayerEntries(boxscore);

  const docs = allEntries
    .map(({ player, teamAbbr }) => buildPlayerAndStatlineDocs(game, teamAbbr, player))
    .filter(Boolean) as Array<{
      mlbID: string;
      playerDoc: Record<string, any>;
      statlineDoc: Record<string, any>;
    }>;

  const statlineDocs = docs.filter((doc) => hasAnyStats(doc.statlineDoc));

  if (docs.length > 0) {
    await db.collection('players').bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { mlbID: doc.mlbID },
          update: {
            $set: doc.playerDoc,
            $setOnInsert: {
              mlbID: doc.mlbID,
              lastUpdate: new Date(),
              'ablstatus.onRoster': false,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    if (statlineDocs.length > 0) {
      await db.collection('statlines').bulkWrite(
        statlineDocs.map((doc) => ({
          updateOne: {
            filter: { _id: doc.statlineDoc.ablDate },
            update: {
              $set: {
                [`p.${doc.statlineDoc.mlbId}_${doc.statlineDoc.gamePk}`]: encodeStatlineEntry(doc.statlineDoc),
              },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }
  }

  return {
    gamePk: game.gamePk,
    skipped: false,
    playerUpdates: statlineDocs.length,
    attributionMode: 'boxscore',
  };
}

async function processResumedGameWithPlayByPlay(db: Db, game: any) {
  const boxscoreUrl = `${MLB_API_BASE}/game/${game.gamePk}/boxscore`;
  const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`;
  const [boxscore, liveFeed] = await Promise.all([fetchJson(boxscoreUrl), fetchJson(feedUrl)]);

  const playerEntries = extractBoxscorePlayerEntries(boxscore);
  const playerMeta = new Map<string, { teamAbbr: string; boxscorePlayer: any }>();
  for (const entry of playerEntries) {
    const mlbID = String(entry?.player?.person?.id || '');
    if (!mlbID) continue;
    playerMeta.set(mlbID, { teamAbbr: entry.teamAbbr, boxscorePlayer: entry.player });
  }

  const accumulatorMap = new Map<string, PlayerDateAccumulator>();
  const plays = Array.isArray(liveFeed?.liveData?.plays?.allPlays) ? liveFeed.liveData.plays.allPlays : [];

  for (const play of plays) {
    const timeRaw = play?.about?.endTime || play?.about?.startTime || game?.gameDate;
    const eventDate = new Date(timeRaw);
    if (Number.isNaN(eventDate.getTime())) continue;
    const ablDate = deriveAblDate(eventDate);

    const batterId = play?.matchup?.batter?.id != null ? String(play.matchup.batter.id) : null;
    if (batterId) {
      const key = playerDateKey(batterId, ablDate);
      const acc = accumulatorMap.get(key) || emptyAccumulator();
      addAccumulatorDate(acc, eventDate);
      bumpPlateAppearanceFromEventType(acc, play?.result?.eventType);
      accumulatorMap.set(key, acc);
    }

    const runners = Array.isArray(play?.runners) ? play.runners : [];
    for (const runner of runners) {
      const runnerId = runner?.details?.runner?.id != null ? String(runner.details.runner.id) : null;
      if (!runnerId) continue;
      const key = playerDateKey(runnerId, ablDate);
      const acc = accumulatorMap.get(key) || emptyAccumulator();
      addAccumulatorDate(acc, eventDate);

      const eventType = String(runner?.details?.eventType || '').toLowerCase();
      if (eventType.startsWith('stolen_base')) {
        acc.stolenBases += 1;
        acc.gamesPlayed = 1;
      } else if (eventType.startsWith('caught_stealing')) {
        acc.caughtStealing += 1;
        acc.gamesPlayed = 1;
      } else if (eventType.startsWith('pickoff')) {
        acc.pickoffs += 1;
        acc.gamesPlayed = 1;
      }

      accumulatorMap.set(key, acc);
    }

    const playEvents = Array.isArray(play?.playEvents) ? play.playEvents : [];
    for (const ev of playEvents) {
      const evType = String(ev?.details?.eventType || '').toLowerCase();
      const credits = Array.isArray(ev?.credits) ? ev.credits : [];
      for (const credit of credits) {
        const fielderId = credit?.player?.id != null ? String(credit.player.id) : null;
        if (!fielderId) continue;
        const key = playerDateKey(fielderId, ablDate);
        const acc = accumulatorMap.get(key) || emptyAccumulator();
        addAccumulatorDate(acc, eventDate);

        const creditType = String(credit?.credit || '').toLowerCase();
        if (evType === 'error' || creditType.includes('error')) {
          acc.errors += 1;
          acc.gamesPlayed = 1;
        }
        if (evType === 'passed_ball' || creditType.includes('passed_ball') || creditType === 'pb') {
          acc.passedBall += 1;
          acc.gamesPlayed = 1;
        }

        accumulatorMap.set(key, acc);
      }
    }
  }

  const docs: Array<{
    mlbID: string;
    playerDoc: Record<string, any>;
    statlineDoc: Record<string, any>;
  }> = [];

  for (const [key, acc] of accumulatorMap.entries()) {
    const [mlbID, ablDate] = key.split('|');
    const meta = playerMeta.get(mlbID);
    if (!meta) continue;

    const boxscorePlayer = meta.boxscorePlayer;
    const isEligible = isPositionPlayer(boxscorePlayer) || acc.atBats > 0 || acc.baseOnBalls > 0 || acc.hitByPitch > 0;
    if (!isEligible) continue;

    const shortPositions = Array.isArray(boxscorePlayer?.allPositions)
      ? boxscorePlayer.allPositions.map((p: any) => p?.abbreviation).filter(Boolean)
      : [];

    const gameDateForDoc = acc.firstEventAt || new Date(game.gameDate);

    // Only include season stats if the boxscore provides non-empty batting data.
    // An empty seasonStats must NOT overwrite existing player stats.
    const newStatsResume = slimSeasonStats(boxscorePlayer?.seasonStats);
    const hasSeasonStatsResume = Object.keys(newStatsResume.batting).length > 0;

    const playerDoc: Record<string, any> = {
      name: boxscorePlayer?.person?.fullName || '',
      team: meta.teamAbbr,
      status: boxscorePlayer?.status?.description || '',
      lastStatUpdate: new Date(game.gameDate),
      ...(hasSeasonStatsResume ? { stats: newStatsResume } : {}),
    };

    const statlineDoc = {
      mlbId: mlbID,
      gameDate: gameDateForDoc,
      gamePk: String(game.gamePk),
      stats: shortenBoxscoreStats(toBoxscoreStatsFromAccumulator(acc)),
      positions: shortPositions,
      statlineType: game?.status?.detailedState,
      ablDate,
    };

    docs.push({ mlbID, playerDoc, statlineDoc });
  }

  const statlineDocs = docs.filter((doc) => hasAnyStats(doc.statlineDoc));

  if (docs.length > 0) {
    await db.collection('players').bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { mlbID: doc.mlbID },
          update: {
            $set: doc.playerDoc,
            $setOnInsert: {
              mlbID: doc.mlbID,
              lastUpdate: new Date(),
              'ablstatus.onRoster': false,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    if (statlineDocs.length > 0) {
      await db.collection('statlines').bulkWrite(
        statlineDocs.map((doc) => ({
          updateOne: {
            filter: { _id: doc.statlineDoc.ablDate },
            update: {
              $set: {
                [`p.${doc.statlineDoc.mlbId}_${doc.statlineDoc.gamePk}`]: encodeStatlineEntry(doc.statlineDoc),
              },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }
  }

  return {
    gamePk: game.gamePk,
    skipped: false,
    playerUpdates: statlineDocs.length,
    attributionMode: 'playByPlay',
    resumed: true,
  };
}

async function processGame(db: Db, game: any) {
  if (shouldUsePlayByPlaySplit(game)) {
    try {
      return await processResumedGameWithPlayByPlay(db, game);
    } catch (error) {
      console.warn(`Falling back to boxscore mode for resumed game ${game?.gamePk}:`, error);
      const fallback = await processGameBoxscore(db, game);
      return {
        ...fallback,
        resumed: true,
        attributionMode: 'boxscore-fallback',
      };
    }
  }

  return processGameBoxscore(db, game);
}

export async function refreshMlbStatsForDate(db: Db, gameDate: Date) {
  const dateYmd = formatDateYmd(gameDate);
  const scheduleUrl = `${MLB_API_BASE}/schedule?sportId=1&date=${dateYmd}`;
  const scheduleData = await fetchJson(scheduleUrl);
  const games = scheduleData?.dates?.[0]?.games || [];

  let playersUpdated = 0;
  let statlinesUpdated = 0;
  const gameSummaries: any[] = [];
  const CONCURRENT_GAME_BATCH = 4;

  // activeGames: must all be Final before ABL day is considered complete
  // suspendedGames: have partial stats to capture but do NOT block finality
  const activeGames: any[] = [];
  const suspendedGames: any[] = [];

  for (const game of games) {
    if (game?.status?.codedGameState === 'D') {
      gameSummaries.push({ gamePk: game.gamePk, skipped: true, reason: 'postponed' });
      continue;
    }

    // Skip spring training games - only process regular season (galleryType=R)
    if (game?.gameType !== 'R') {
      continue;
    }

    if (isCurrentlySuspended(game)) {
      // Suspended mid-game: capture partial stats but don't block other games from finalizing
      suspendedGames.push(game);
    } else {
      activeGames.push(game);
    }
  }

  const allProcessableGames = [...activeGames, ...suspendedGames];
  for (let i = 0; i < allProcessableGames.length; i += CONCURRENT_GAME_BATCH) {
    const batch = allProcessableGames.slice(i, i + CONCURRENT_GAME_BATCH);
    // allSettled so one failing game never kills the rest of the batch
    const batchResults = await Promise.allSettled(batch.map((game) => processGame(db, game)));

    for (const settled of batchResults) {
      if (settled.status === 'fulfilled') {
        playersUpdated += settled.value.playerUpdates;
        statlinesUpdated += settled.value.playerUpdates;
        gameSummaries.push(settled.value);
      } else {
        console.warn('[refreshMlbStatsForDate] Game processing failed:', settled.reason);
        gameSummaries.push({ skipped: true, reason: 'error', error: String(settled.reason) });
      }
    }
  }

  // All active (non-postponed, non-suspended, regular season) MLB games must be Final for
  // scores to be official. Suspended games have partial stats already captured and will be
  // fully reconciled when the continuation game is processed on resumption day.
  const allMlbGamesComplete =
    activeGames.length === 0 ||
    activeGames.every((game: any) => game?.status?.abstractGameState === 'Final');

  // At least one MLB game must have started (Live or Final) before ABL results should
  // be calculated. If all games are still in 'Preview', MLB stats haven't recorded yet
  // and we should leave ABL games in 'Scheduled' status.
  const anyMlbGamesStarted =
    suspendedGames.length > 0 ||
    activeGames.some((game: any) =>
      game?.status?.abstractGameState === 'Live' ||
      game?.status?.abstractGameState === 'Final',
    );

  // ── Supplemental season-stats refresh ─────────────────────────────────────
  // After processing individual boxscores, fetch the full-season batting totals
  // from the MLB Stats API.  This mirrors what the admin sync-batting tool does
  // and acts as a safety net: if any player's seasonStats were missing or empty
  // in their boxscore (e.g. season debut, called-up mid-game), we still land on
  // the correct season-to-date numbers.  Uses a partial $set on stats.batting so
  // we never accidentally wipe other sub-fields.
  const season = gameDate.getUTCFullYear();
  const seasonStatsUrl = `${MLB_API_BASE}/stats?stats=season&group=hitting&gameType=R&season=${season}&sportId=1&limit=5000`;
  try {
    const seasonStatsData = await fetchJson(seasonStatsUrl);
    const splits: any[] = seasonStatsData?.stats?.[0]?.splits ?? [];

    const seasonStatOps: any[] = [];
    for (const split of splits) {
      const mlbId = String(split.player?.id ?? '');
      const posAbbr: string = split.position?.abbreviation ?? '';
      if (!mlbId || posAbbr === 'P') continue;

      const batting: Record<string, number> = {};
      for (const field of SEASON_STAT_BATTING_FIELDS) {
        const v = toNumber(split.stat?.[field]);
        if (v !== 0) batting[field] = v;
      }
      if (Object.keys(batting).length === 0) continue;

      seasonStatOps.push({
        updateOne: {
          filter: { mlbID: mlbId },
          update: { $set: { 'stats.batting': batting, lastStatUpdate: new Date() } },
        },
      });
    }

    if (seasonStatOps.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < seasonStatOps.length; i += BATCH) {
        await db.collection('players').bulkWrite(seasonStatOps.slice(i, i + BATCH), { ordered: false });
      }
      playersUpdated += seasonStatOps.length;
    }
  } catch (err) {
    console.warn('[refreshMlbStatsForDate] Supplemental season-stats fetch failed:', err);
  }

  // ── Supplemental season fielding stats refresh ──────────────────────────────
  // Fetch season fielding totals so errors are populated for all position players.
  // A player can appear multiple times (once per team if traded), so we accumulate
  // errors per mlbId before writing.
  // limit=5000 matches the batting supplemental above; the MLB position-player
  // pool (including multi-team splits) is well under 3000 entries per season.
  const fieldingStatsUrl = `${MLB_API_BASE}/stats?stats=season&group=fielding&gameType=R&season=${season}&sportId=1&limit=5000`;
  try {
    const fieldingStatsData = await fetchJson(fieldingStatsUrl);
    const fieldingSplits: any[] = fieldingStatsData?.stats?.[0]?.splits ?? [];

    const errorsByPlayer = new Map<string, number>();
    for (const split of fieldingSplits) {
      const mlbId = String(split.player?.id ?? '');
      const posAbbr: string = split.position?.abbreviation ?? '';
      // ABL only scores position players; pitchers are excluded throughout the system.
      if (!mlbId || posAbbr === 'P') continue;
      const e = toNumber(split.stat?.errors);
      if (e > 0) {
        errorsByPlayer.set(mlbId, (errorsByPlayer.get(mlbId) ?? 0) + e);
      }
    }

    const fieldingStatOps: any[] = [];
    for (const [mlbId, errors] of errorsByPlayer) {
      fieldingStatOps.push({
        updateOne: {
          filter: { mlbID: mlbId },
          update: { $set: { 'stats.fielding.errors': errors } },
        },
      });
    }

    if (fieldingStatOps.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < fieldingStatOps.length; i += BATCH) {
        await db.collection('players').bulkWrite(fieldingStatOps.slice(i, i + BATCH), { ordered: false });
      }
      playersUpdated += fieldingStatOps.length;
    }
  } catch (err) {
    console.warn('[refreshMlbStatsForDate] Supplemental fielding-stats fetch failed:', err);
  }

  return {
    date: dateYmd,
    scheduledGames: games.length,
    suspendedGames: suspendedGames.length,
    playersUpdated,
    statlinesUpdated,
    gameSummaries,
    allMlbGamesComplete,
    anyMlbGamesStarted,
  };
}

export async function ensureRostersLockedForGames(db: Db, games: any[], officialDate: string) {
  // Collect unique team IDs across all games
  const allTeamIds = new Set<string>();
  for (const game of games) {
    if (game.homeTeam) allTeamIds.add(game.homeTeam.toString());
    if (game.awayTeam) allTeamIds.add(game.awayTeam.toString());
  }

  if (allTeamIds.size === 0) return { locked: 0, alreadySet: 0 };

  // Fetch the most recent lineup per team on or before the game date (one aggregation)
  const teamObjectIds = Array.from(allTeamIds).map((id) => new ObjectId(id));
  const lineupDocs = await db
    .collection('lineups')
    .aggregate([
      { $match: { ablTeam: { $in: teamObjectIds }, effectiveDate: { $lte: officialDate } } },
      { $sort: { ablTeam: 1, effectiveDate: -1 } },
      { $group: { _id: '$ablTeam', roster: { $first: '$roster' }, effectiveDate: { $first: '$effectiveDate' } } },
    ])
    .toArray();

  // Build teamId -> roster map
  const rosterByTeam = new Map<string, any[]>();
  for (const doc of lineupDocs) {
    rosterByTeam.set(doc._id.toString(), doc.roster || []);
  }

  let locked = 0;
  let alreadySet = 0;

  for (const game of games) {
    const homeId = game.homeTeam?.toString();
    const awayId = game.awayTeam?.toString();
    const hasHome = Array.isArray(game.homeTeamRoster) && game.homeTeamRoster.length > 0;
    const hasAway = Array.isArray(game.awayTeamRoster) && game.awayTeamRoster.length > 0;

    if (hasHome && hasAway) {
      alreadySet++;
    }

    const homeRoster = rosterByTeam.get(homeId) ?? [];
    const awayRoster = rosterByTeam.get(awayId) ?? [];

    if (homeRoster.length === 0 && awayRoster.length === 0) continue;

    // Normalise roster items to { player, lineupPosition, rosterOrder }
    const normalise = (roster: any[]) =>
      roster.map((item) => ({
        player: item.player,
        lineupPosition: item.lineupPosition ?? null,
        rosterOrder: item.rosterOrder ?? 0,
      }));

    const normalised = {
      ...(homeRoster.length > 0 ? { homeTeamRoster: normalise(homeRoster) } : {}),
      ...(awayRoster.length > 0 ? { awayTeamRoster: normalise(awayRoster) } : {}),
    };

    if (Object.keys(normalised).length > 0) {
      // Write to DB so subsequent processes (admin recalc, etc.) also have rosters
      await db.collection('games').updateOne(
        { _id: game._id },
        { $set: { ...normalised, rostersLockedAt: new Date() } }
      );
      // Also mutate the in-memory object so the caller sees them immediately
      Object.assign(game, normalised);
      locked++;
    }
  }

  return { locked, alreadySet };
}

export async function recalculateAblGamesForDate(db: Db, gameDate: Date, options?: { isFinal?: boolean }) {
  const dayStart = new Date(Date.UTC(gameDate.getUTCFullYear(), gameDate.getUTCMonth(), gameDate.getUTCDate(), 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(gameDate.getUTCFullYear(), gameDate.getUTCMonth(), gameDate.getUTCDate(), 23, 59, 59, 999));

  const games = await db
    .collection('games')
    .find({ gameDate: { $gte: dayStart, $lte: dayEnd } })
    .sort({ gameDate: 1, _id: 1 })
    .allowDiskUse(true)
    .toArray();

  // Ensure rosters are locked onto game docs before scoring
  const officialDate = formatDateYmd(gameDate);
  const rosterLockSummary = await ensureRostersLockedForGames(db, games, officialDate);

  const isFinal = options?.isFinal ?? false;
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const game of games) {
    try {
      const outcome = await calculateAndStoreLiveGameResult(db, game, { save: true, isFinal });
      if (outcome.status === 'skipped') {
        skipped++;
      } else {
        processed++;
      }
    } catch {
      errors++;
    }
  }

  return {
    date: formatDateYmd(gameDate),
    totalGames: games.length,
    processed,
    skipped,
    errors,
    rosterLockSummary,
    isFinal,
  };
}

export async function runDailyStatRefresh(db: Db, gameDate: Date, options?: { recalculate?: boolean }) {
  const refreshSummary = await refreshMlbStatsForDate(db, gameDate);

  let recalcSummary: any = null;
  // Only recalculate ABL game results once at least one MLB game has actually started.
  // If all MLB games are still in 'Preview' (no stats recorded yet), skip recalculation
  // so ABL games remain in 'Scheduled' status rather than flipping to 'In Progress'.
  if (options?.recalculate !== false && refreshSummary.anyMlbGamesStarted) {
    recalcSummary = await recalculateAblGamesForDate(db, gameDate, {
      isFinal: refreshSummary.allMlbGamesComplete,
    });
  }

  return {
    refreshSummary,
    recalcSummary,
  };
}
