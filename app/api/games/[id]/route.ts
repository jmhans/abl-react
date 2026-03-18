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
    const db = await connectToDatabase();
    
    const result = await db.collection('games').aggregate([
      {
        $match: { _id: new ObjectId(id) }
      },
      {
        $addFields: {
          results: {
            $cond: {
              if: { $isArray: '$results' },
              then: '$results',
              else: ['$results']
            }
          }
        }
      },
      {
        $addFields: {
          results: {
            $filter: {
              input: '$results',
              as: 'res',
              cond: { $ne: ['$$res', null] }
            }
          }
        }
      }
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
    if (game.awayTeam) teamIds.push(new ObjectId(game.awayTeam));
    if (game.homeTeam) teamIds.push(new ObjectId(game.homeTeam));

    const teams = await db.collection('ablteams')
      .find({ _id: { $in: teamIds } })
      .toArray();
    
    const teamMap = new Map(teams.map(t => [t._id.toString(), t]));

    // Populate teams
    if (game.awayTeam) game.awayTeam = teamMap.get(game.awayTeam.toString());
    if (game.homeTeam) game.homeTeam = teamMap.get(game.homeTeam.toString());

    // Populate players in rosters
    const playerIds = new Set<string>();
    [...(game.awayTeamRoster || []), ...(game.homeTeamRoster || [])]
      .forEach((p: any) => {
        if (p.player) playerIds.add(p.player.toString());
      });

    if (playerIds.size > 0) {
      const players = await db.collection('players')
        .find({ _id: { $in: Array.from(playerIds).map(id => new ObjectId(id)) } })
        .toArray();
      
      const playerMap = new Map(players.map(p => [p._id.toString(), p]));

      [game.awayTeamRoster, game.homeTeamRoster].forEach(roster => {
        roster?.forEach((p: any) => {
          if (p.player) p.player = playerMap.get(p.player.toString());
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
