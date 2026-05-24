import { Db, ObjectId } from 'mongodb';
import { calculateAblPoints } from './roster-utils';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SplitBucket {
  g: number;
  ab: number;
  h: number;
  '2b': number;
  '3b': number;
  hr: number;
  bb: number;
  hbp: number;
  sb: number;
  cs: number;
  sac: number;
  sf: number;
  po: number;
  /** ABL score = (points / ab) − 4.5. Null when ab === 0. */
  abl: number | null;
}

export interface PlayerSplits {
  /** Keyed by the number of calendar days, e.g. lastN[10] = stats for the last 10 days. */
  lastN: Record<number, SplitBucket>;
  /** Stats on ABL "on days" (not Mon/Thu, on/after the first ABL game). */
  ablOn: SplitBucket;
  /** Stats on ABL "off days" (Mon or Thu during the ABL season). */
  ablOff: SplitBucket;
}

export type SplitsMap = Record<string, PlayerSplits>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyBucket(): SplitBucket {
  return {
    g: 0, ab: 0, h: 0, '2b': 0, '3b': 0, hr: 0,
    bb: 0, hbp: 0, sb: 0, cs: 0, sac: 0, sf: 0, po: 0,
    abl: null,
  };
}

function addEntryToBucket(bucket: SplitBucket, b: any): void {
  bucket.g    += b.g    || 0;
  bucket.ab   += b.ab   || 0;
  bucket.h    += b.h    || 0;
  bucket['2b'] += b['2b'] || 0;
  bucket['3b'] += b['3b'] || 0;
  bucket.hr   += b.hr   || 0;
  bucket.bb   += b.bb   || 0;
  bucket.hbp  += b.hbp  || 0;
  bucket.sb   += b.sb   || 0;
  bucket.cs   += b.cs   || 0;
  bucket.sac  += b.sac  || 0;
  bucket.sf   += b.sf   || 0;
  bucket.po   += b.po   || 0;
}

function finaliseBucket(bucket: SplitBucket): SplitBucket {
  if (bucket.ab === 0) return bucket; // abl stays null
  const pts = calculateAblPoints(bucket);
  return { ...bucket, abl: pts / bucket.ab - 4.5 };
}

/**
 * Converts any timestamp to an ABL date string (YYYY-MM-DD).
 * ABL scoring days roll over at 08:00 UTC.
 */
function toAblDate(date: Date): string {
  const shifted = new Date(date.getTime() - 8 * 60 * 60 * 1000);
  return shifted.toISOString().substring(0, 10);
}

/**
 * Returns true if the ABL date string falls on an ABL off-day (Monday or Thursday).
 * Evaluated at UTC noon to avoid any DST ambiguity.
 */
function isAblOffDay(ablDateStr: string): boolean {
  const d = new Date(ablDateStr + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, 4=Thu
  return dow === 1 || dow === 4;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Computes partial-season stat splits for a set of MLB player IDs.
 *
 * Splits returned per player:
 *   - lastN[N]  — cumulative stats for the last N calendar days
 *   - ablOn     — stats on ABL game days (not Mon/Thu, on/after first ABL game)
 *   - ablOff    — stats on ABL off days (Mon or Thu during the ABL season)
 *
 * The first ABL game date is derived from the `games` collection scoped to the
 * provided leagueTeamIds, so on/off classification is contextualised per league.
 */
export async function computePlayerSplits(
  db: Db,
  mlbIds: string[],
  options: {
    lastNDays: number[];
    leagueTeamIds?: any[];  // MongoDB ObjectIds for the active league's teams
    seasonId?: ObjectId;    // Current season ObjectId — scopes ABL game lookup to this season
  },
): Promise<SplitsMap> {
  const { lastNDays, leagueTeamIds = [], seasonId } = options;

  // ── 1. Find the first ABL game date for this league/season ────────────────
  let ablSeasonStart: string | null = null;
  if (leagueTeamIds.length > 0) {
    const gamesFilter: Record<string, any> = {
      $or: [
        { homeTeam: { $in: leagueTeamIds } },
        { awayTeam: { $in: leagueTeamIds } },
      ],
    };
    if (seasonId) gamesFilter.seasonId = seasonId;
    const firstGame = await db.collection('games').findOne(
      gamesFilter,
      { sort: { gameDate: 1 }, projection: { gameDate: 1 } },
    );
    if (firstGame?.gameDate) {
      ablSeasonStart = toAblDate(new Date(firstGame.gameDate));
    }
  }

  // ── 2. Determine the date range to fetch from statlines ───────────────────
  const todayAblDate = toAblDate(new Date());
  const maxN = Math.max(...lastNDays);
  const lastNStartDate = toAblDate(new Date(Date.now() - maxN * 24 * 60 * 60 * 1000));

  // Hard floor: MLB 2026 Opening Day — always fetch from here so pre-ABL games
  // are available for the ablOff bucket.
  const MLB_SEASON_FLOOR = '2026-03-26';
  const fetchFrom = [
    MLB_SEASON_FLOOR,
    lastNStartDate,
  ].reduce((a, b) => (a < b ? a : b));

  // ── 3. Fetch statline docs for the range ───────────────────────────────────
  const statlineDocs = await db
    .collection('statlines')
    .find({ _id: { $gte: fetchFrom, $lte: todayAblDate } as any })
    .sort({ _id: 1 })
    .toArray();

  // ── 4. Pre-compute the calendar start date for each N ─────────────────────
  const lastNStartDates: Record<number, string> = {};
  for (const n of lastNDays) {
    lastNStartDates[n] = toAblDate(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
  }

  // ── 5. Initialise result buckets ──────────────────────────────────────────
  const result: SplitsMap = {};
  for (const mlbId of mlbIds) {
    const lastN: Record<number, SplitBucket> = {};
    for (const n of lastNDays) lastN[n] = emptyBucket();
    result[mlbId] = { lastN, ablOn: emptyBucket(), ablOff: emptyBucket() };
  }

  // ── 6. Accumulate ─────────────────────────────────────────────────────────
  for (const doc of statlineDocs) {
    const dateStr = doc._id as unknown as string;
    const entries = doc.p as Record<string, any> | undefined;
    if (!entries) continue;

    const inAblSeason = ablSeasonStart ? dateStr >= ablSeasonStart : false;
    const preAbl    = ablSeasonStart ? dateStr < ablSeasonStart : true;
    const offDay = preAbl || (inAblSeason && isAblOffDay(dateStr));
    const onDay  = inAblSeason && !isAblOffDay(dateStr);

    for (const mlbId of mlbIds) {
      const prefix = mlbId + '_';
      for (const [key, entry] of Object.entries(entries)) {
        if (!key.startsWith(prefix) || !entry?.b) continue;
        const b = entry.b;
        const splits = result[mlbId];

        for (const n of lastNDays) {
          if (dateStr >= lastNStartDates[n]) addEntryToBucket(splits.lastN[n], b);
        }
        if (onDay)  addEntryToBucket(splits.ablOn,  b);
        if (offDay) addEntryToBucket(splits.ablOff, b);
      }
    }
  }

  // ── 7. Compute ABL scores for all buckets ─────────────────────────────────
  for (const mlbId of mlbIds) {
    const s = result[mlbId];
    for (const n of lastNDays) s.lastN[n] = finaliseBucket(s.lastN[n]);
    s.ablOn  = finaliseBucket(s.ablOn);
    s.ablOff = finaliseBucket(s.ablOff);
  }

  return result;
}
