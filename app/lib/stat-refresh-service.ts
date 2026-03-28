import { Db } from 'mongodb';
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
  return Boolean(game?.resumeDate || game?.resumeGameDate || game?.resumedFrom);
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

function hasAnyStats(statlineDoc: { stats: { batting: Record<string, number>; fielding: { e: number; pb: number } } }): boolean {
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

  const playerDoc = {
    name: boxscorePlayer?.person?.fullName || '',
    team: teamAbbr,
    status: boxscorePlayer?.status?.description || '',
    stats: boxscorePlayer?.seasonStats || {},
    lastStatUpdate: gameDate,
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
            filter: {
              mlbId: doc.statlineDoc.mlbId,
              gamePk: doc.statlineDoc.gamePk,
              ablDate: doc.statlineDoc.ablDate,
            },
            update: { $set: doc.statlineDoc },
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

    const playerDoc = {
      name: boxscorePlayer?.person?.fullName || '',
      team: meta.teamAbbr,
      status: boxscorePlayer?.status?.description || '',
      stats: boxscorePlayer?.seasonStats || {},
      lastStatUpdate: new Date(game.gameDate),
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
            filter: {
              mlbId: doc.statlineDoc.mlbId,
              gamePk: doc.statlineDoc.gamePk,
              ablDate: doc.statlineDoc.ablDate,
            },
            update: { $set: doc.statlineDoc },
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

  const activeGames: any[] = [];

  for (const game of games) {
    if (game?.status?.codedGameState === 'D') {
      gameSummaries.push({ gamePk: game.gamePk, skipped: true, reason: 'postponed' });
      continue;
    }

    activeGames.push(game);
  }

  for (let i = 0; i < activeGames.length; i += CONCURRENT_GAME_BATCH) {
    const batch = activeGames.slice(i, i + CONCURRENT_GAME_BATCH);
    const batchResults = await Promise.all(batch.map((game) => processGame(db, game)));

    for (const result of batchResults) {
      playersUpdated += result.playerUpdates;
      statlinesUpdated += result.playerUpdates;
      gameSummaries.push(result);
    }
  }

  return {
    date: dateYmd,
    scheduledGames: games.length,
    playersUpdated,
    statlinesUpdated,
    gameSummaries,
  };
}

export async function recalculateAblGamesForDate(db: Db, gameDate: Date) {
  const dayStart = new Date(Date.UTC(gameDate.getUTCFullYear(), gameDate.getUTCMonth(), gameDate.getUTCDate(), 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(gameDate.getUTCFullYear(), gameDate.getUTCMonth(), gameDate.getUTCDate(), 23, 59, 59, 999));

  const games = await db
    .collection('games')
    .find({ gameDate: { $gte: dayStart, $lte: dayEnd } })
    .sort({ gameDate: 1, _id: 1 })
    .allowDiskUse(true)
    .toArray();

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const game of games) {
    try {
      const outcome = await calculateAndStoreLiveGameResult(db, game, { save: true });
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
  };
}

export async function runDailyStatRefresh(db: Db, gameDate: Date, options?: { recalculate?: boolean }) {
  const refreshSummary = await refreshMlbStatsForDate(db, gameDate);

  let recalcSummary: any = null;
  if (options?.recalculate !== false) {
    recalcSummary = await recalculateAblGamesForDate(db, gameDate);
  }

  return {
    refreshSummary,
    recalcSummary,
  };
}
