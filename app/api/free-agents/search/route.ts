import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

// GET /api/free-agents/search - Autocomplete search for all players
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get('q') || '';

    if (q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // Search across all players (not just free agents) for autocomplete
    const results = await db.collection('players_view')
      .find({
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { mlbID: { $regex: q, $options: 'i' } }
        ]
      })
      .sort({ name: 1 })
      .limit(10)
      .project({ _id: 1, name: 1, team: 1, position: 1, ablstatus: 1 })
      .toArray();

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
