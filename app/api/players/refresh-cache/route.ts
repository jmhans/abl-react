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
import { rebuildPlayersCache } from '@/app/lib/roster-utils';

export async function POST() {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const t0 = Date.now();

    const count = await rebuildPlayersCache(db);

    const elapsed = Date.now() - t0;

    console.log(`[refresh-cache] players_cache rebuilt: ${count} docs in ${elapsed}ms`);
    return NextResponse.json({ ok: true, players: count, ms: elapsed });
  } catch (error) {
    console.error('Error rebuilding player cache:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rebuild cache' },
      { status: 500 },
    );
  }
}
