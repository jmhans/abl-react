import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { calculateAndStoreLiveGameResult } from '@/app/lib/game-calculation-service';
import { getAdminAuthState } from '@/app/lib/admin-auth';

// POST /api/games/:id/calculate-results - Calculate and save game results
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await params;
    const db = await connectToDatabase();

    // Get game
    const game = await db.collection('games').findOne({ _id: new ObjectId(id) });

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Validate we have rosters
    if (!game.awayTeamRoster || !game.homeTeamRoster) {
      return NextResponse.json(
        { error: 'Game does not have rosters set' },
        { status: 400 }
      );
    }

    const calcOutcome = await calculateAndStoreLiveGameResult(db, game, { save: true });

    if (!calcOutcome.game) {
      return NextResponse.json({ error: 'Failed to update game' }, { status: 500 });
    }

    // Return the updated game with populated teams
    const teams = await db
      .collection('ablteams')
      .find({ _id: { $in: [game.homeTeam, game.awayTeam] } })
      .toArray();

    const teamMap = new Map(teams.map(t => [t._id.toString(), t]));
    const updatedGame = calcOutcome.game;
    updatedGame.homeTeam = teamMap.get(game.homeTeam.toString());
    updatedGame.awayTeam = teamMap.get(game.awayTeam.toString());

    return NextResponse.json(updatedGame, { status: 200 });
  } catch (error) {
    console.error('Error calculating game results:', error);
    return NextResponse.json(
      {
        error: 'Failed to calculate game results',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
