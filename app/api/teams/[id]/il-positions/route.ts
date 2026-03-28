import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getNextRosterEffectiveDate } from '@/app/lib/roster-utils';

// GET /api/teams/:id/il-positions - Get eligible positions for IL players on team
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await connectToDatabase();
    const { id: teamId } = await params;
    const effectiveDate = await getNextRosterEffectiveDate(db);

    // Get current roster
    const lineup = await db.collection('lineups').findOne({
      ablTeam: new ObjectId(teamId),
      effectiveDate: effectiveDate
    });

    if (!lineup) {
      return NextResponse.json({ ilPositions: [] });
    }

    // Filter for players on IL (lineupPosition is 'INJ' or 'NA')
    const ilPlayerIds = lineup.roster
      .filter((r: any) => r.lineupPosition === 'INJ' || r.lineupPosition === 'NA')
      .map((r: any) => r.player);

    if (ilPlayerIds.length === 0) {
      return NextResponse.json({ ilPositions: [] });
    }

    // Get eligible positions for IL players
    const ilPlayers = await db.collection('players_view')
      .find({ _id: { $in: ilPlayerIds } })
      .toArray();

    // Collect all eligible positions from IL players
    const ilPositions = new Set<string>();
    ilPlayers.forEach((p: any) => {
      if (Array.isArray(p.eligible)) {
        p.eligible.forEach((pos: string) => {
          ilPositions.add(pos);
        });
      }
    });

    return NextResponse.json({ 
      ilPositions: Array.from(ilPositions),
      ilPlayerCount: ilPlayerIds.length
    });
  } catch (error) {
    console.error('IL positions error:', error);
    return NextResponse.json(
      { error: 'Failed to get IL positions' },
      { status: 500 }
    );
  }
}
