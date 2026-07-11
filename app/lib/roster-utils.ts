import { Db } from 'mongodb';
import { deriveAblDate } from '@/app/lib/abl-date';

/**
 * Calculate ABL (ABL Fantasy) score from batting stats
 * Formula from Angular app:
 * (hits*25 + doubles*10 + triples*20 + homeRuns*30 + baseOnBalls*10 + hitByPitch*10 + 
 *  stolenBases*7 + caughtStealing*(-7) + pickoffs*(-7) + (sacBunts + sacFlies)*5) / atBats - 4.5
 */
export function calculateAblScore(stats: any): number {
  if (!stats || !stats.batting || stats.batting.atBats === 0) {
    return 0;
  }

  const b = stats.batting;
  const points =
    (b.hits || 0) * 25 +
    (b.doubles || 0) * 10 +
    (b.triples || 0) * 20 +
    (b.homeRuns || 0) * 30 +
    (b.baseOnBalls || 0) * 10 +
    (b.hitByPitch || 0) * 10 +
    (b.stolenBases || 0) * 7 +
    (b.caughtStealing || 0) * -7 +
    (b.pickoffs || 0) * -7 +
    ((b.sacBunts || 0) + (b.sacFlies || 0)) * 5;

  return points / b.atBats - 4.5;
}

/** Compute AVG / SLG / OPS from raw batting stats. Returns nulls when AB = 0. */
export function calculateSlashLine(stats: any): { avg: number | null; slg: number | null; ops: number | null } {
  const b = stats?.batting;
  if (!b || !b.atBats) return { avg: null, slg: null, ops: null };

  const ab   = b.atBats      ?? 0;
  const h    = b.hits        ?? 0;
  const d    = b.doubles     ?? 0;
  const t    = b.triples     ?? 0;
  const hr   = b.homeRuns    ?? 0;
  const bb   = b.baseOnBalls ?? 0;
  const hbp  = b.hitByPitch  ?? 0;
  const sf   = b.sacFlies    ?? 0;

  const avg = h / ab;
  const tb  = (h - d - t - hr) + 2 * d + 3 * t + 4 * hr;
  const slg = tb / ab;
  const obpDenom = ab + bb + hbp + sf;
  const obp = obpDenom > 0 ? (h + bb + hbp) / obpDenom : 0;
  const ops = obp + slg;

  return { avg, slg, ops };
}

/**
 * Calculate raw ABL points (numerator only, before division by AB)
 * Used for team-level aggregation
 */
export function calculateAblPoints(stats: any): number {
  if (!stats) {
    return 0;
  }

  // Support both stats.batting and stats at root level
  const b = stats.batting || stats;
  
  if (!b) return 0;

  return (
    (b.hits || b.h || 0) * 25 +
    (b.doubles || b['2b'] || 0) * 10 +
    (b.triples || b['3b'] || 0) * 20 +
    (b.homeRuns || b.hr || 0) * 30 +
    (b.baseOnBalls || b.bb || 0) * 10 +
    (b.hitByPitch || b.hbp || 0) * 10 +
    (b.stolenBases || b.sb || 0) * 7 +
    (b.caughtStealing || b.cs || 0) * -7 +
    (b.pickoffs || b.po || 0) * -7 +
    ((b.sacBunts || b.sac || 0) + (b.sacFlies || b.sf || 0)) * 5
  );
}

/**
 * Rebuilds players_cache from players_view, then post-processes:
 *   - Computes `abl` score for each player
 *   - Strips stale stats (lastStatUpdate before SEASON_START)
 *   - Creates mlbID index
 * Returns count of docs processed.
 */
export const SEASON_START = new Date('2026-03-26T00:00:00Z');

export async function rebuildPlayersCache(db: Db): Promise<number> {
  await db.collection('players_view').aggregate([{ $out: 'players_cache' }]).toArray();
  await db.collection('players_cache').createIndex({ mlbID: 1 }, { background: true });

  const allDocs = await db.collection('players_cache').find({}, {
    projection: { _id: 1, stats: 1, lastStatUpdate: 1 },
  }).toArray();

  const bulkOps: any[] = [];
  for (const doc of allDocs) {
    const lastUpdate = doc.lastStatUpdate ? new Date(doc.lastStatUpdate) : null;
    const statsAreStale = !lastUpdate || lastUpdate < SEASON_START;
    const stats = statsAreStale ? undefined : doc.stats;
    const abl = calculateAblScore(stats);

    const setFields: any = { abl };
    const unsetFields: any = {};
    if (statsAreStale && doc.stats) unsetFields.stats = '';

    const update: any = { $set: setFields };
    if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;
    bulkOps.push({ updateOne: { filter: { _id: doc._id }, update } });
  }

  if (bulkOps.length > 0) {
    await db.collection('players_cache').bulkWrite(bulkOps, { ordered: false });
  }

  return allDocs.length;
}

/**
 * Convert a date to noon Central Time, returned as UTC
 * Handles DST properly
 */
export function getNoonCTAsUTC(date: Date): Date {
  // Create date at noon local time
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  
  // Create noon CT time
  // CT is UTC-6 (CST) or UTC-5 (CDT)
  // Noon CT = 18:00 UTC (CST) or 17:00 UTC (CDT)
  
  // Use Intl API to handle DST correctly
  const ctString = new Date(year, month, day, 12, 0, 0).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Parse back to get UTC time
  const ctDate = new Date(year, month, day, 12, 0, 0);
  const utcDate = new Date(ctString);
  const offset = ctDate.getTime() - utcDate.getTime();
  
  return new Date(ctDate.getTime() + offset);
}

/**
 * Get eligible positions for a player
 * Tries to get from player.eligible array, falls back to player.position field,
 * or uses a default set of standard positions
 */
export function getEligiblePositions(player: any): string[] {
  // If player already has eligible array with positions, use it
  if (Array.isArray(player.eligible) && player.eligible.length > 0) {
    return player.eligible;
  }

  // If player has a single position field, wrap it in array
  if (player.position && typeof player.position === 'string') {
    return [player.position];
  }

  // If player has mlbPosition, use standard positions based on it
  if (player.mlbPosition && typeof player.mlbPosition === 'string') {
    const pos = player.mlbPosition.toUpperCase();
    // Map MLB positions to standard positions
    if (pos.includes('C')) return ['C'];
    if (pos.includes('1B')) return ['1B'];
    if (pos.includes('2B')) return ['2B'];
    if (pos.includes('3B')) return ['3B'];
    if (pos.includes('SS')) return ['SS'];
    if (pos.includes('OF')) return ['OF', 'LF', 'CF', 'RF'];
    if (pos.includes('DH')) return ['DH', 'OF'];
  }

  // Default fallback: standard positions
  return ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];
}

export function enrichPlayersWithEligibility(players: any[]): any[] {
  return players.map(player => ({
    ...player,
    eligible: getEligiblePositions(player)
  }));
}
/**
 * Get the first MLB regular-season game start time for a given official date.
 * Uses the mlbgameschemas collection (kept fresh by the sync-mlb-schedule cron).
 * Falls back to noon CT on that day when no non-TBD games are found.
 *
 * @param officialDate  YYYY-MM-DD string matching mlbgameschemas.officialDate
 */
export async function getFirstMlbGameTimeForDate(db: Db, officialDate: string): Promise<Date> {
  const first = await db.collection('mlbgameschemas')
    .find({
      officialDate,
      gameType: 'R',
      'status.startTimeTBD': { $ne: true },
    })
    .sort({ gameDate: 1 })
    .limit(1)
    .toArray();

  if (first.length > 0) {
    return new Date(first[0].gameDate as string);
  }

  // Fallback: noon CT on that day
  const [year, month, day] = officialDate.split('-').map(Number);
  return getNoonCTAsUTC(new Date(year, month - 1, day));
}

/**
 * Returns the YYYY-MM-DD date string for the next upcoming ABL game day.
 * This is the value stored in lineups.effectiveDate.
 *
 * Logic:
 *   - If today's roster is NOT yet locked (first MLB game hasn't started), return
 *     today's ABL date. The effectiveDate should be TODAY so that any roster
 *     changes made before lock are applied to today's games.
 *   - If today's roster IS locked, find the next ABL game date after today and
 *     return that. Edits made after lock apply to the next game day.
 *
 * This replaces the previous approach of querying ABL games with
 * `gameDate >= now`, which broke because ABL game records store gameDate as
 * midnight UTC — by evening that timestamp has already passed and the query
 * incorrectly jumped to the next day, causing the lineup to be saved with the
 * wrong effectiveDate and skipped during scoring.
 */
export async function getNextRosterGameDate(db: Db): Promise<string> {
  const todayAblDate = deriveAblDate(new Date());

  // Check whether today's roster window has closed (first MLB game started)
  const lockTime = await getFirstMlbGameTimeForDate(db, todayAblDate);
  if (Date.now() < lockTime.getTime()) {
    // Pre-lock: changes are for today's games
    return todayAblDate;
  }

  // Post-lock: find the next ABL game date strictly after today
  const [y, m, d] = todayAblDate.split('-').map(Number);
  const tomorrowStart = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));

  const nextGames = await db.collection('games')
    .find({ gameDate: { $gte: tomorrowStart }, gameType: 'R' })
    .sort({ gameDate: 1 })
    .limit(1)
    .toArray();

  if (nextGames.length === 0) {
    // Off-season / no upcoming games — use tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }

  return new Date(nextGames[0].gameDate).toISOString().slice(0, 10);
}

/**
 * Get roster for a specific team and game date
 * Used by game scoring logic
 * Returns the most recent roster with effectiveDate <= game's official date
 */
export async function getRosterForGame(db: Db, teamId: string, gameDateOrOfficialDate: Date | string) {
  try {
    const { ObjectId } = require('mongodb');

    // Accept either a Date (extract YYYY-MM-DD) or an already-formatted string
    const officialDate = typeof gameDateOrOfficialDate === 'string'
      ? gameDateOrOfficialDate.slice(0, 10)
      : new Date(gameDateOrOfficialDate).toISOString().slice(0, 10);

    const lineups = await db.collection('lineups')
      .find({
        ablTeam: new ObjectId(teamId),
        effectiveDate: { $lte: officialDate },
      })
      .sort({ effectiveDate: -1 })
      .limit(1)
      .toArray();

    return lineups[0] || null;

  } catch (error) {
    console.error('Error getting roster for game:', error);
    throw error;
  }
}

/**
 * Check if roster is currently locked for the next game
 * Rosters lock when current time passes the first MLB game start on that day
 */
export async function isRosterLocked(db: Db): Promise<boolean> {
  const gameDate = await getNextRosterGameDate(db);
  const lockTime = await getFirstMlbGameTimeForDate(db, gameDate);
  return new Date() >= lockTime;
}

/**
 * Get time remaining until roster lock
 * Returns milliseconds, or null if there are no upcoming games
 */
export async function getTimeUntilLock(db: Db): Promise<number | null> {
  const gameDate = await getNextRosterGameDate(db);
  const lockTime = await getFirstMlbGameTimeForDate(db, gameDate);
  const remaining = lockTime.getTime() - Date.now();
  return Math.max(0, remaining);
}

/**
 * Get the lock time (as ISO string) for the next roster game date.
 * Exposed so API routes can include it in responses.
 */
export async function getNextRosterLockTime(db: Db): Promise<string> {
  const gameDate = await getNextRosterGameDate(db);
  const lockTime = await getFirstMlbGameTimeForDate(db, gameDate);
  return lockTime.toISOString();
}
