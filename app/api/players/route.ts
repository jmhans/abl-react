import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/players - Get all players from players_view.
// players_view computes status from the mlbrosters collection via $lookup,
// so no additional overlay is needed here.
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const players = await db.collection('players_view').find({}).toArray();
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
