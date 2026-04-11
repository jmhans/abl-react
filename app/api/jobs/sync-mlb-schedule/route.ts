import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const LOOKAHEAD_DAYS = 14;

/**
 * GET /api/jobs/sync-mlb-schedule
 *
 * Fetches the next LOOKAHEAD_DAYS of MLB regular-season games from the Stats API
 * and upserts them into the mlbgameschemas collection.
 *
 * Run daily (early morning) so that roster lock times reflect the latest schedule,
 * including any games that have been rescheduled.
 *
 * Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date();
    const startDate = today.toISOString().slice(0, 10);
    const endDate = new Date(today.getTime() + LOOKAHEAD_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const url =
      `${MLB_API}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&gameType=R`;

    const resp = await fetch(url, { next: { revalidate: 0 } });
    if (!resp.ok) {
      throw new Error(`MLB Stats API responded ${resp.status}: ${resp.statusText}`);
    }
    const data = await resp.json();

    const db = await connectToDatabase();

    // Ensure an index exists for efficient lookups by officialDate + gameType
    await db
      .collection('mlbgameschemas')
      .createIndex({ officialDate: 1, gameType: 1, gameDate: 1 }, { background: true });

    const bulkOps: any[] = [];
    for (const dateEntry of data.dates ?? []) {
      for (const game of dateEntry.games ?? []) {
        bulkOps.push({
          updateOne: {
            filter: { gamePk: game.gamePk },
            update: {
              $set: {
                gamePk: game.gamePk,
                gameDate: game.gameDate,       // stored as string, matches existing schema
                officialDate: game.officialDate,
                gameType: game.gameType,
                season: game.season,
                status: game.status,
                teams: game.teams,
              },
            },
            upsert: true,
          },
        });
      }
    }

    let upserted = 0;
    if (bulkOps.length > 0) {
      const result = await db.collection('mlbgameschemas').bulkWrite(bulkOps, { ordered: false });
      upserted = result.upsertedCount + result.modifiedCount;
    }

    return NextResponse.json({
      success: true,
      range: `${startDate} to ${endDate}`,
      fetched: bulkOps.length,
      upserted,
    });
  } catch (error) {
    console.error('sync-mlb-schedule error:', error);
    return NextResponse.json(
      { error: 'Sync failed', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
