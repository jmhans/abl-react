/**
 * POST /api/players/update-positions
 *
 * Scans all statlines for the current season, computes each player's most-played
 * position (CommishPos) and their eligible positions (≥ GAMES_FOR_ELIGIBLE appearances),
 * then writes:
 *   - `positions`    collection: { mlbId, CommishPos }  (used by players_view)
 *   - `position_log` collection: { mlbId, season, maxPosition, eligiblePositions, positionsLog }
 *
 * Players with no current-season appearances are cleared from `positions` so
 * players_view falls back to the prior-year position_log entry automatically.
 *
 * After running, rebuild players_cache via POST /api/players/refresh-cache to surface
 * the updated eligibility in the draft page.
 */

import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';

const SEASON_YEAR = 2026;
const GAMES_FOR_ELIGIBLE = 10;
const EXCLUDED = new Set(['PH', 'PR', 'P']);
const OF_POSITIONS = new Set(['RF', 'CF', 'LF']);

function normalizePos(pos: string): string {
  return OF_POSITIONS.has(pos) ? 'OF' : pos;
}

export async function POST() {
  const { isAdmin } = await getAdminAuthState();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = await connectToDatabase();

  // 1. Load all statline docs for the current season
  const seasonPrefix = `${SEASON_YEAR}-`;
  const statDocs = await db
    .collection('statlines')
    .find({ _id: { $regex: `^${seasonPrefix}` } as any }, { projection: { p: 1 } })
    .toArray();

  if (statDocs.length === 0) {
    return NextResponse.json({
      ok: true,
      message: 'No statlines found for current season — positions collection cleared.',
      playersProcessed: 0,
      positionsUpserted: 0,
      posLogUpserted: 0,
    });
  }

  // 2. Aggregate per-player position counts: mlbId → { pos → games }
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

      // Normalize and deduplicate within game (RF+CF in same game = 1 OF credit)
      const normalized = [...new Set(rawPositions.map(normalizePos))];
      for (const pos of normalized) {
        if (!EXCLUDED.has(pos)) {
          counts.set(pos, (counts.get(pos) ?? 0) + 1);
        }
      }
    }
  }

  // 3. Build bulk write ops
  const positionsOps: any[] = [];
  const posLogOps: any[] = [];

  for (const [mlbId, counts] of playerPosCounts) {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const maxPos = sorted[0]?.[0] ?? 'DH';
    const eligiblePositions = sorted
      .filter(([, ct]) => ct >= GAMES_FOR_ELIGIBLE)
      .map(([pos]) => pos);
    const positionsLog = sorted.map(([pos, ct]) => ({ pos, ct }));

    positionsOps.push({
      updateOne: {
        filter: { mlbId },
        update: { $set: { mlbId, CommishPos: maxPos } },
        upsert: true,
      },
    });

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

  // 4. Clear CommishPos for players with no current-season appearances
  //    (players_view will then fall back to prior-year position_log)
  const activeMlbIds = [...playerPosCounts.keys()];
  await db.collection('positions').deleteMany({
    mlbId: { $nin: activeMlbIds },
  });

  // 5. Apply in batches of 500
  const BATCH = 500;
  let positionsUpserted = 0;
  let posLogUpserted = 0;

  for (let i = 0; i < positionsOps.length; i += BATCH) {
    const r = await db.collection('positions').bulkWrite(positionsOps.slice(i, i + BATCH), { ordered: false });
    positionsUpserted += r.upsertedCount + r.modifiedCount;
  }

  for (let i = 0; i < posLogOps.length; i += BATCH) {
    const r = await db.collection('position_log').bulkWrite(posLogOps.slice(i, i + BATCH), { ordered: false });
    posLogUpserted += r.upsertedCount + r.modifiedCount;
  }

  return NextResponse.json({
    ok: true,
    season: SEASON_YEAR,
    playersProcessed: playerPosCounts.size,
    positionsUpserted,
    posLogUpserted,
    gamesForEligible: GAMES_FOR_ELIGIBLE,
  });
}
