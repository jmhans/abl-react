import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';
import {
  computePlayerSplits,
  hydrateSplitsFromLiveDoc,
  LIVE_SPLIT_PERIODS,
  LivePlayerSplitsDoc,
} from '@/app/lib/stat-splits';

const MAX_DAYS = 60;
const MAX_IDS  = 2000;
const SPLITS_CACHE_TTL_MS = 30 * 1000;

const splitsCache = new Map<string, { expiresAt: number; payload: any }>();
const splitsInFlight = new Map<string, Promise<any>>();

function buildSplitsCacheKey(params: {
  mlbIds: string[];
  days: number[];
  league: string;
  season: string;
}): string {
  const ids = [...params.mlbIds].sort().join(',');
  const days = [...params.days].sort((a, b) => a - b).join(',');
  return `${params.league}|${params.season}|${days}|${ids}`;
}

function getCachedSplits(cacheKey: string): any | null {
  const hit = splitsCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    splitsCache.delete(cacheKey);
    return null;
  }
  return hit.payload;
}

function setCachedSplits(cacheKey: string, payload: any) {
  const now = Date.now();
  splitsCache.set(cacheKey, { expiresAt: now + SPLITS_CACHE_TTL_MS, payload });
  if (splitsCache.size > 64) {
    for (const [key, value] of splitsCache) {
      if (value.expiresAt <= now) splitsCache.delete(key);
    }
  }
}

/**
 * POST /api/players/splits
 *
 * Body:
 *   mlbIds  string[]   — MLB player IDs to compute splits for
 *   days    number[]   — e.g. [7, 10, 14, 20, 30]
 *   league  string     — league slug (used to find first ABL game date)
 *   season  string     — season slug or "active"
 *
 * Returns:
 *   { splits: Record<mlbId, { lastN, ablOn, ablOff }> }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      mlbIds,
      days     = [10, 20],
      league   = '',
      season   = 'active',
    } = body as {
      mlbIds?: unknown;
      days?:   unknown;
      league?: string;
      season?: string;
    };

    // Validate mlbIds
    if (!Array.isArray(mlbIds) || mlbIds.length === 0) {
      return NextResponse.json({ error: 'mlbIds array required' }, { status: 400 });
    }
    const cleanIds = [...new Set(
      mlbIds
        .map((id: unknown) => String(id).trim())
        .filter(Boolean),
    )].slice(0, MAX_IDS);

    // Validate days
    const rawDays = Array.isArray(days) ? days : [days];
    const cleanDays = rawDays
      .map((n: unknown) => parseInt(String(n), 10))
      .filter((n) => !isNaN(n) && n > 0 && n <= MAX_DAYS);

    if (cleanDays.length === 0) {
      return NextResponse.json({ error: 'No valid days specified' }, { status: 400 });
    }

    const cacheKey = buildSplitsCacheKey({
      mlbIds: cleanIds,
      days: cleanDays,
      league,
      season,
    });

    const cached = getCachedSplits(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-splits-cache': 'HIT' } });
    }

    const inFlight = splitsInFlight.get(cacheKey);
    if (inFlight) {
      const payload = await inFlight;
      return NextResponse.json(payload, { headers: { 'x-splits-cache': 'WAIT' } });
    }

    const computePromise = (async () => {
      const db = await connectToDatabase();

      // Resolve league team IDs (for ABL season-start detection)
      let leagueTeamIds: any[] = [];
      let seasonId: any = undefined;
      let leagueId = '';
      if (league) {
        try {
          const ctx = await resolveLeagueContext(db, league, season);
          leagueId = String(ctx.league._id);
          leagueTeamIds = ctx.season.teamIds;
          seasonId = ctx.season._id;
        } catch {
          // Unknown league — on/off classification will be disabled
        }
      }

      const isLivePeriodSet = cleanDays.every((d) => LIVE_SPLIT_PERIODS.includes(d as any));
      const mergedSplits: Record<string, any> = {};
      let remainingIds = cleanIds;

      if (leagueId && seasonId && isLivePeriodSet) {
        const liveDocs = await db.collection<LivePlayerSplitsDoc>('player_splits_live').find(
          {
            leagueId,
            seasonId: String(seasonId),
            mlbId: { $in: cleanIds },
          },
          {
            projection: {
              _id: 0,
              leagueId: 1,
              seasonId: 1,
              mlbId: 1,
              lastN: 1,
              ablOn: 1,
              ablOff: 1,
            },
          }
        ).toArray();

        const foundIds = new Set<string>();
        for (const doc of liveDocs) {
          if (!doc?.mlbId) continue;
          foundIds.add(doc.mlbId);
          mergedSplits[doc.mlbId] = hydrateSplitsFromLiveDoc(doc, cleanDays);
        }
        remainingIds = cleanIds.filter((id) => !foundIds.has(id));
      }

      if (remainingIds.length > 0) {
        const computedSplits = await computePlayerSplits(db, remainingIds, {
          lastNDays: cleanDays,
          leagueTeamIds,
          seasonId,
        });
        Object.assign(mergedSplits, computedSplits);
      }

      const payload = { splits: mergedSplits };
      setCachedSplits(cacheKey, payload);
      return payload;
    })();

    splitsInFlight.set(cacheKey, computePromise);
    try {
      const payload = await computePromise;
      return NextResponse.json(payload, { headers: { 'x-splits-cache': 'MISS' } });
    } finally {
      splitsInFlight.delete(cacheKey);
    }
  } catch (err) {
    console.error('[/api/players/splits]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
