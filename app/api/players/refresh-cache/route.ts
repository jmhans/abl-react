/**
 * POST /api/players/refresh-cache
 *
 * Admin-only. Materializes players_view into a real players_cache collection
 * using MongoDB $out (atomic replacement). This is the expensive ~25s operation;
 * afterwards /api/players and /api/free-agents read from players_cache with a fast find().
 *
 * Also pre-computes `abl` score and clears stale stats (lastStatUpdate before Opening Day)
 * so every read-path is just a simple find() with no aggregation or JS computation.
 *
 * Call after:
 *   - Syncing rosters (mlbrosters update changes status/eligibility)
 *   - Running MLB stat refresh (updates stats.batting & lastStatUpdate)
 *   - Any manual player data edits
 */
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { calculateAblScore } from '@/app/lib/roster-utils';

// Stats written before Opening Day are from the prior season
const SEASON_START = new Date('2026-03-26T00:00:00Z');

export async function POST() {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const t0 = Date.now();

    // Run the full players_view pipeline and write results atomically to players_cache.
    // $out replaces the target collection in a single atomic operation — reads against
    // players_cache continue to see the old data until the write completes.
    await db.collection('players_view').aggregate([
      { $out: 'players_cache' },
    ]).toArray();

    // Index mlbID for the projection join in /api/players
    await db.collection('players_cache').createIndex({ mlbID: 1 }, { background: true });

    // Post-process: pre-compute abl score and strip stale stats so every
    // subsequent read is a zero-cost find().
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
      if (statsAreStale && doc.stats) {
        unsetFields.stats = '';
      }

      const update: any = { $set: setFields };
      if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;

      bulkOps.push({ updateOne: { filter: { _id: doc._id }, update } });
    }

    if (bulkOps.length > 0) {
      await db.collection('players_cache').bulkWrite(bulkOps, { ordered: false });
    }

    const elapsed = Date.now() - t0;
    const count = await db.collection('players_cache').countDocuments();

    console.log(`[refresh-cache] players_cache rebuilt: ${count} docs in ${elapsed}ms (${bulkOps.length} post-processed)`);
    return NextResponse.json({ ok: true, players: count, ms: elapsed });
  } catch (error) {
    console.error('Error rebuilding player cache:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rebuild cache' },
      { status: 500 },
    );
  }
}
