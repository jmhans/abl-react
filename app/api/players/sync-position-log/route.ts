/**
 * POST /api/players/sync-position-log
 *
 * Updates position_log eligibility from current-season statlines WITHOUT
 * touching the `positions` collection (CommishPos). CommishPos is a one-time
 * commish-set value; this route is safe to run on every daily stat refresh.
 *
 * Writes to position_log:
 *   { mlbId, season, maxPosition, eligiblePositions, positionsLog }
 *
 * Then triggers players_cache rebuild so updated eligibility is live immediately.
 *
 * Can be called by the daily-stat-refresh job (no auth cookie needed when using
 * the CRON_SECRET header) or manually from the admin UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Db } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { rebuildPlayersCache } from '@/app/lib/roster-utils';

const SEASON_YEAR = 2026;
const GAMES_FOR_ELIGIBLE = 10;
const EXCLUDED = new Set(['PH', 'PR', 'P']);
const OF_POSITIONS = new Set(['RF', 'CF', 'LF']);

function normalizePos(pos: string): string {
  return OF_POSITIONS.has(pos) ? 'OF' : pos;
}

export async function syncPositionLog(db: Db): Promise<{
  playersProcessed: number;
  posLogUpserted: number;
}> {
  const seasonPrefix = `${SEASON_YEAR}-`;
  const statDocs = await db
    .collection('statlines')
    .find({ _id: { $regex: `^${seasonPrefix}` } as any }, { projection: { p: 1 } })
    .toArray();

  if (statDocs.length === 0) {
    return { playersProcessed: 0, posLogUpserted: 0 };
  }

  // Aggregate per-player position counts: mlbId → { pos → games }
  const playerPosCounts = new Map<string, Map<string, number>>();

  for (const doc of statDocs) {
    const entries: Record<string, { pos?: string[] }> = (doc as any).p ?? {};
    for (const [key, val] of Object.entries(entries)) {
      const mlbId = key.split('_')[0];
      const rawPositions: string[] = val.pos ?? [];

      let counts = playerPosCounts.get(mlbId);
      if (!counts) {
        counts = new Map();
        playerPosCounts.set(mlbId, counts);
      }

      // Normalize and deduplicate within game (RF+CF = 1 OF credit)
      const normalized = [...new Set(rawPositions.map(normalizePos))];
      for (const pos of normalized) {
        if (!EXCLUDED.has(pos)) {
          counts.set(pos, (counts.get(pos) ?? 0) + 1);
        }
      }
    }
  }

  // Build bulk write ops for position_log only
  const posLogOps: any[] = [];

  for (const [mlbId, counts] of playerPosCounts) {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const maxPos = sorted[0]?.[0] ?? 'DH';
    const eligiblePositions = sorted
      .filter(([, ct]) => ct >= GAMES_FOR_ELIGIBLE)
      .map(([pos]) => pos);
    const positionsLog = sorted.map(([pos, ct]) => ({ pos, ct }));

    posLogOps.push({
      updateOne: {
        filter: { mlbId, season: SEASON_YEAR },
        update: {
          $set: {
            mlbId,
            season: SEASON_YEAR,
            maxPosition: maxPos,
            eligiblePositions,
            positionsLog,
          },
        },
        upsert: true,
      },
    });
  }

  const BATCH = 500;
  let posLogUpserted = 0;
  for (let i = 0; i < posLogOps.length; i += BATCH) {
    const r = await db.collection('position_log').bulkWrite(posLogOps.slice(i, i + BATCH), { ordered: false });
    posLogUpserted += r.upsertedCount + r.modifiedCount;
  }

  // Rebuild players_cache so updated eligibility is immediately live
  await rebuildPlayersCache(db);

  return { playersProcessed: playerPosCounts.size, posLogUpserted };
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerSecret = request.headers.get('x-cron-secret') || '';
  return token === secret || headerSecret === secret;
}

export async function POST(request: NextRequest) {
  const { isAdmin } = await getAdminAuthState();
  if (!isAdmin && !isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = await connectToDatabase();
    const { playersProcessed, posLogUpserted } = await syncPositionLog(db);
    return NextResponse.json({
      ok: true,
      season: SEASON_YEAR,
      gamesForEligible: GAMES_FOR_ELIGIBLE,
      playersProcessed,
      posLogUpserted,
    });
  } catch (error) {
    console.error('sync-position-log failed:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'sync-position-log failed' },
      { status: 500 }
    );
  }
}
