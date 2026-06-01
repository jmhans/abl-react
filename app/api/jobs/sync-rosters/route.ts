import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { syncRosters } from '@/app/api/players/sync-rosters/route';

/**
 * GET /api/jobs/sync-rosters
 *
 * Nightly job to refresh MLB 40-man roster status data into `mlbrosters`,
 * update `players.team`, and rebuild `players_cache` so status changes are
 * immediately reflected across the app.
 *
 * Protected by CRON_SECRET. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = await connectToDatabase();
    const summary = await syncRosters(db, { rebuildCache: true });

    return NextResponse.json({
      ok: true,
      ...summary,
    });
  } catch (error) {
    console.error('Nightly sync-rosters failed:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'sync-rosters failed' },
      { status: 500 },
    );
  }
}
