import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

// GET /api/leagues — list all leagues
export async function GET(_req: NextRequest) {
  try {
    const db = await connectToDatabase();
    const leagues = await db.collection('leagues').find({}).toArray();
    return NextResponse.json(leagues);
  } catch (error) {
    console.error('Error fetching leagues:', error);
    return NextResponse.json({ error: 'Failed to fetch leagues' }, { status: 500 });
  }
}
