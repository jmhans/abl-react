import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

const CURRENT_SEASON = 2026;
// Stats written before Opening Day are from the prior season and should be hidden.
const SEASON_START = new Date('2026-03-26T00:00:00Z');

function currentSeasonStats(p: any): any {
  const lastUpdate = p.lastStatUpdate ? new Date(p.lastStatUpdate) : null;
  if (!lastUpdate || lastUpdate < SEASON_START) return undefined;
  return p.stats;
}

// GET /api/players - Get all players from players_cache (materialized from
// players_view), enriched with projections where available.
// Run POST /api/players/refresh-cache to rebuild the materialized collection.
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const projSystem = request.nextUrl.searchParams.get('projSystem');

    const projFilter: Record<string, unknown> = { season: CURRENT_SEASON };
    if (projSystem) projFilter.projSystem = projSystem;

    // Use players_cache (materialized from players_view) if it exists — fast find().
    // Falls back to players_view if the admin hasn't run refresh-cache yet.
    const cacheCount = await db.collection('players_cache').estimatedDocumentCount();
    const sourceCollection = cacheCount > 0 ? 'players_cache' : 'players_view';

    const t0 = Date.now();
    const [players, projRows] = await Promise.all([
      db.collection(sourceCollection).find({
        $or: [
          { 'eligible.0': { $exists: true } },
          { 'stats.batting.atBats': { $gt: 0 } },
        ],
      }).toArray(),
      db
        .collection('projections')
        .find(projFilter, {
          projection: { mlbId: 1, ablProjected: 1, projSystem: 1, stats: 1 },
          sort: { importedAt: -1 },
        })
        .toArray(),
    ]);

    console.log(`[/api/players] ${sourceCollection} fetch: ${Date.now() - t0}ms — players=${players.length} projections=${projRows.length}`);

    // Build mlbId → projection map (first doc wins due to sort importedAt desc)
    const projMap = new Map<string, typeof projRows[0]>();
    for (const p of projRows) {
      if (p.mlbId && !projMap.has(p.mlbId)) {
        projMap.set(p.mlbId, p);
      }
    }

    const result = players.map((player) => {
      const proj = player.mlbID ? projMap.get(String(player.mlbID)) ?? null : null;
      const stats = currentSeasonStats(player);
      return {
        ...player,
        stats,
        ablProjected: proj?.ablProjected ?? null,
        projSystem: proj?.projSystem ?? null,
        projStats: proj?.stats ?? null,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching players:', error);
    return NextResponse.json(
      { error: 'Failed to fetch players' },
      { status: 500 }
    );
  }
}

// POST /api/players - Create a new player
export async function POST(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const body = await request.json();
    
    // Add timestamps
    const playerData = {
      ...body,
      lastUpdate: new Date(),
    };
    
    const result = await db.collection('players').insertOne(playerData);
    const player = await db.collection('players').findOne({ _id: result.insertedId });
    
    return NextResponse.json(player, { status: 201 });
  } catch (error) {
    console.error('Error creating player:', error);
    return NextResponse.json(
      { error: 'Failed to create player' },
      { status: 500 }
    );
  }
}
