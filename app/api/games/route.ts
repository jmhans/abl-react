import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/games - Get all games with populated teams
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view');
    const display = searchParams.get('display');
    
    // Build aggregation pipeline
    const pipeline: any[] = [
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
    ];

    // Playoffs filter
    if (display === 'playoffs') {
      pipeline.unshift({
        $match: { 
          gameDate: { $gte: new Date('2023-08-22T00:00:00Z') } 
        }
      });
    }

    // Summary view - exclude heavy fields
    if (view === 'summary') {
      pipeline.push({
        $project: {
          awayTeamRoster: 0,
          homeTeamRoster: 0,
          'results.scores.players': 0
        }
      });
    }

    const games = await db.collection('games').aggregate(pipeline).toArray();
    
    // Populate team references
    const teamIds = new Set<string>();
    games.forEach(game => {
      if (game.awayTeam) teamIds.add(game.awayTeam.toString());
      if (game.homeTeam) teamIds.add(game.homeTeam.toString());
      game.results?.forEach((result: any) => {
        if (result.winner) teamIds.add(result.winner.toString());
        if (result.loser) teamIds.add(result.loser.toString());
      });
    });

    const teams = await db.collection('ablteams')
      .find({ _id: { $in: Array.from(teamIds).map(id => new ObjectId(id)) } })
      .toArray();
    
    const teamMap = new Map(teams.map(t => [t._id.toString(), t]));

    // Populate teams in response
    games.forEach(game => {
      if (game.awayTeam) game.awayTeam = teamMap.get(game.awayTeam.toString());
      if (game.homeTeam) game.homeTeam = teamMap.get(game.homeTeam.toString());
      game.results?.forEach((result: any) => {
        if (result.winner) result.winner = teamMap.get(result.winner.toString());
        if (result.loser) result.loser = teamMap.get(result.loser.toString());
      });
    });

    return NextResponse.json(games);
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}

// POST /api/games - Create new game(s)
export async function POST(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const body = await request.json();
    
    const gamesToCreate = Array.isArray(body) ? body : [body];
    const createdGames = [];

    for (const gameDetails of gamesToCreate) {
      // Check for duplicate
      const existingGame = await db.collection('games').findOne({
        awayTeam: new ObjectId(gameDetails.awayTeam),
        homeTeam: new ObjectId(gameDetails.homeTeam),
        gameDate: new Date(gameDetails.gameDate)
      });

      if (existingGame) {
        throw new Error('Game already exists with those details');
      }

      const game = {
        awayTeam: new ObjectId(gameDetails.awayTeam),
        homeTeam: new ObjectId(gameDetails.homeTeam),
        gameDate: new Date(gameDetails.gameDate),
        description: gameDetails.description,
        gameType: gameDetails.gameType || 'R'
      };

      const result = await db.collection('games').insertOne(game);
      const createdGame = await db.collection('games').findOne({ _id: result.insertedId });
      createdGames.push(createdGame);
    }

    return NextResponse.json(createdGames[0] || createdGames, { status: 201 });
  } catch (error) {
    console.error('Error creating game:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create game' },
      { status: 500 }
    );
  }
}
