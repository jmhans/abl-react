import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/players - Get all players from players_view.
// players_view computes status from the mlbrosters collection via $lookup,
// so no additional overlay is needed here.
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    // Exclude pure pitchers: keep players who have at least one eligible position
    // (position history from batting appearances) or who have at least 1 AB this
    // season (covers two-way players whose eligible may not yet be populated).
    // This prevents pitcher-only 40-man roster members from cluttering player lists.
    const players = await db.collection('players_view').find({
      $or: [
        { 'eligible.0': { $exists: true } },       // has at least one eligible position
        { 'stats.batting.atBats': { $gt: 0 } },    // or has at least 1 AB this season
      ],
    }).toArray();
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
