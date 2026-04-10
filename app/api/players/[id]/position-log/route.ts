import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

const SEASON_YEAR = 2026;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: mlbId } = await params;
    const db = await connectToDatabase();
    const doc = await db.collection('position_log').findOne(
      { mlbId: String(mlbId), season: SEASON_YEAR },
      { projection: { positionsLog: 1, eligiblePositions: 1, _id: 0 } },
    );
    if (!doc) {
      return NextResponse.json({ positionsLog: [], eligiblePositions: [] });
    }
    return NextResponse.json({
      positionsLog: doc.positionsLog ?? [],
      eligiblePositions: doc.eligiblePositions ?? [],
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch position log' }, { status: 500 });
  }
}
