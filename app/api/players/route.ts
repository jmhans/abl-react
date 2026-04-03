import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

const CURRENT_SEASON = 2026;

// GET /api/players - Get all players from players_view, enriched with
// projections (ablProjected) where available.
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    // Exclude pure pitchers and join latest projection for each player.
    const players = await db.collection('players_view').aggregate([
      {
        $match: {
          $or: [
            { 'eligible.0': { $exists: true } },
            { 'stats.batting.atBats': { $gt: 0 } },
          ],
        },
      },
      {
        $lookup: {
          from: 'projections',
          let: { pid: '$mlbID' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$mlbId', '$$pid'] },
                    { $eq: ['$season', CURRENT_SEASON] },
                  ],
                },
              },
            },
            { $sort: { importedAt: -1 } },
            { $limit: 1 },
          ],
          as: 'proj',
        },
      },
      {
        $addFields: {
          ablProjected: { $ifNull: [{ $first: '$proj.ablProjected' }, null] },
          projSystem: { $ifNull: [{ $first: '$proj.projSystem' }, null] },
          projStats: { $ifNull: [{ $first: '$proj.stats' }, null] },
        },
      },
      { $project: { proj: 0 } },
    ]).toArray();
    return NextResponse.json(players);
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
