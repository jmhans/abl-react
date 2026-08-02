import { Db, ObjectId } from 'mongodb';
import { calculateAblPoints } from './roster-utils';
import { resolveLeagueContext } from './league-context';
import { isAblGameDay } from './abl-date';

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

export const LIVE_SPLIT_PERIODS = [7, 10, 14, 20, 30] as const;

export interface CompactSplitBucket {
  g: number;
  ab: number;
  abl: number | null;
}

export interface LivePlayerSplitsDoc {
  leagueId: string;
  seasonId: string;
  mlbId: string;
  lastN: Record<string, CompactSplitBucket>;
  ablOn: CompactSplitBucket;
  ablOff: CompactSplitBucket;
  updatedAt: Date;
}

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

function toCompactBucket(bucket: SplitBucket): CompactSplitBucket {
  return {
    g: bucket.g,
    ab: bucket.ab,
    abl: bucket.abl,
  };
}

function fromCompactBucket(bucket?: CompactSplitBucket): SplitBucket {
  const compact = bucket ?? { g: 0, ab: 0, abl: null };
  return {
    ...emptyBucket(),
    g: compact.g ?? 0,
    ab: compact.ab ?? 0,
    abl: compact.abl ?? null,
  };
}

export function hydrateSplitsFromLiveDoc(doc: LivePlayerSplitsDoc, requestedDays: number[]): PlayerSplits {
  const lastN: Record<number, SplitBucket> = {};
  for (const d of requestedDays) {
    lastN[d] = fromCompactBucket(doc.lastN?.[String(d)]);
  }
  return {
    lastN,
    ablOn: fromCompactBucket(doc.ablOn),
    ablOff: fromCompactBucket(doc.ablOff),
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
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
 */
function isAblOffDay(ablDateStr: string): boolean {
  return !isAblGameDay(ablDateStr);
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
  const targetIdSet = new Set(mlbIds);

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

    for (const [key, entry] of Object.entries(entries)) {
      if (!entry?.b) continue;
      const underscoreIdx = key.indexOf('_');
      if (underscoreIdx <= 0) continue;
      const mlbId = key.slice(0, underscoreIdx);
      if (!targetIdSet.has(mlbId)) continue;

      const b = entry.b;
      const splits = result[mlbId];
      if (!splits) continue;

      for (const n of lastNDays) {
        if (dateStr >= lastNStartDates[n]) addEntryToBucket(splits.lastN[n], b);
      }
      if (onDay)  addEntryToBucket(splits.ablOn,  b);
      if (offDay) addEntryToBucket(splits.ablOff, b);
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

/**
 * Builds/refreshes compact per-player "live" splits for a league season.
 * Stored shape intentionally keeps only the fields needed by UI rendering.
 */
export async function refreshPersistedLiveSplits(
  db: Db,
  options?: { leagueSlug?: string; seasonSlug?: string; playerMlbIds?: string[] }
): Promise<{ playersScanned: number; playersPersisted: number }> {
  const leagueSlug = options?.leagueSlug || 'abl';
  const seasonSlug = options?.seasonSlug || 'active';

  const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

  const cacheCount = await db.collection('players_cache').estimatedDocumentCount();
  const sourceCollection = cacheCount > 0 ? 'players_cache' : 'players_view';

  const mlbIds = options?.playerMlbIds && options.playerMlbIds.length > 0
    ? [...new Set(options.playerMlbIds.map((id) => String(id).trim()).filter(Boolean))]
    : [...new Set(
        (await db.collection(sourceCollection)
          .find(
            {
              $and: [
                { mlbID: { $exists: true, $ne: null } },
                {
                  $or: [
                    { 'eligible.0': { $exists: true } },
                    { 'stats.batting.atBats': { $gt: 0 } },
                  ],
                },
              ],
            },
            { projection: { mlbID: 1 } }
          )
          .toArray())
          .map((p: any) => String(p.mlbID).trim())
          .filter(Boolean),
      )];

  if (mlbIds.length === 0) {
    return { playersScanned: 0, playersPersisted: 0 };
  }

  const splits = await computePlayerSplits(db, mlbIds, {
    lastNDays: [...LIVE_SPLIT_PERIODS],
    leagueTeamIds: season.teamIds,
    seasonId: season._id,
  });

  const now = new Date();
  await db.collection('player_splits_live').createIndex(
    { leagueId: 1, seasonId: 1, mlbId: 1 },
    { unique: true, name: 'league_season_player_unique' }
  );

  let persisted = 0;
  for (const idsChunk of chunk(mlbIds, 500)) {
    const ops = idsChunk.map((mlbId) => {
      const s = splits[mlbId];
      if (!s) return null;
      const compactLastN: Record<string, CompactSplitBucket> = {};
      for (const d of LIVE_SPLIT_PERIODS) {
        compactLastN[String(d)] = toCompactBucket(s.lastN[d]);
      }
      return {
        updateOne: {
          filter: {
            leagueId: league._id.toString(),
            seasonId: season._id.toString(),
            mlbId,
          },
          update: {
            $set: {
              leagueId: league._id.toString(),
              seasonId: season._id.toString(),
              mlbId,
              lastN: compactLastN,
              ablOn: toCompactBucket(s.ablOn),
              ablOff: toCompactBucket(s.ablOff),
              updatedAt: now,
            },
          },
          upsert: true,
        },
      };
    }).filter(Boolean) as any[];

    if (ops.length > 0) {
      await db.collection('player_splits_live').bulkWrite(ops, { ordered: false });
      persisted += ops.length;
    }
  }

  return {
    playersScanned: mlbIds.length,
    playersPersisted: persisted,
  };
}
