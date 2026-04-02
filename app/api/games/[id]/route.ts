import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/games/:id - Get a single game with full details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || !/^[a-f\d]{24}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid game id' }, { status: 400 });
    }

    const db = await connectToDatabase();
    
    const result = await db.collection('games').aggregate([
      {
        $match: { _id: new ObjectId(id) }
      },
    ]).toArray();

    if (!result || result.length === 0) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    const game = result[0];

    // Populate team and player references
    const teamIds = [];
    try {
      if (game.awayTeam) teamIds.push(new ObjectId(game.awayTeam.toString()));
      if (game.homeTeam) teamIds.push(new ObjectId(game.homeTeam.toString()));
    } catch {
      // awayTeam/homeTeam may already be populated objects — skip
    }

    const teams = teamIds.length > 0
      ? await db.collection('ablteams').find({ _id: { $in: teamIds } }).toArray()
      : [];
    
    const teamMap = new Map(teams.map(t => [t._id.toString(), t]));

    // Populate teams (only if still ObjectId references)
    if (game.awayTeam && typeof game.awayTeam !== 'object') {
      game.awayTeam = teamMap.get(game.awayTeam.toString()) ?? game.awayTeam;
    } else if (game.awayTeam?._id) {
      // already populated
    } else if (game.awayTeam) {
      game.awayTeam = teamMap.get(game.awayTeam.toString()) ?? game.awayTeam;
    }
    if (game.homeTeam && typeof game.homeTeam !== 'object') {
      game.homeTeam = teamMap.get(game.homeTeam.toString()) ?? game.homeTeam;
    } else if (game.homeTeam?._id) {
      // already populated
    } else if (game.homeTeam) {
      game.homeTeam = teamMap.get(game.homeTeam.toString()) ?? game.homeTeam;
    }

    // Populate players in rosters
    const playerIds = new Set<string>();
    [...(game.awayTeamRoster || []), ...(game.homeTeamRoster || [])]
      .forEach((p: any) => {
        if (p.player && typeof p.player !== 'object') playerIds.add(p.player.toString());
      });

    if (playerIds.size > 0) {
      const playerObjectIds = [];
      for (const pid of playerIds) {
        try { playerObjectIds.push(new ObjectId(pid)); } catch { /* skip invalid */ }
      }
      const players = playerObjectIds.length > 0
        ? await db.collection('players').find({ _id: { $in: playerObjectIds } }).toArray()
        : [];
      
      const playerMap = new Map(players.map(p => [p._id.toString(), p]));

      [game.awayTeamRoster, game.homeTeamRoster].forEach(roster => {
        roster?.forEach((p: any) => {
          if (p.player && typeof p.player !== 'object') {
            p.player = playerMap.get(p.player.toString()) ?? p.player;
          }
        });
      });
    }

    return NextResponse.json(game);
  } catch (error) {
    console.error('Error fetching game:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game' },
      { status: 500 }
    );
  }
}

// PUT /api/games/:id - Update game
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();
    const body = await request.json();

    const updateData: any = {};
    if (body.description) updateData.description = body.description;
    if (body.awayTeam) updateData.awayTeam = new ObjectId(body.awayTeam._id || body.awayTeam);
    if (body.homeTeam) updateData.homeTeam = new ObjectId(body.homeTeam._id || body.homeTeam);
    if (body.gameDate) updateData.gameDate = new Date(body.gameDate);

    const result = await db.collection('games').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error updating game:', error);
    return NextResponse.json(
      { error: 'Failed to update game' },
      { status: 500 }
    );
  }
}
