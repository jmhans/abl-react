import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

// GET /api/leagues/[slug] — get one league with its seasons
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = await connectToDatabase();

    const league = await db.collection('leagues').findOne({ slug });
    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const seasons = await db
      .collection('seasons')
      .find({ leagueId: league._id })
      .sort({ year: -1 })
      .toArray();

    return NextResponse.json({ ...league, seasons });
  } catch (error) {
    console.error('Error fetching league:', error);
    return NextResponse.json({ error: 'Failed to fetch league' }, { status: 500 });
  }
}
