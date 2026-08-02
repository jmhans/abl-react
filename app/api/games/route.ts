import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

// GET /api/games - Get all games with populated teams
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view');
    const leagueParam = searchParams.get('league');
    const seasonParam = searchParams.get('season');

    // Build aggregation pipeline
    const pipeline: any[] = [];

    // League+season scoping (optional – falls back to all games if omitted)
    if (leagueParam && seasonParam) {
      try {
        const ctx = await resolveLeagueContext(db, leagueParam, seasonParam);
        pipeline.push({
          $match: {
            leagueId: ctx.league._id,
            seasonId: ctx.season._id,
          },
        });
      } catch {
        // Unknown league/season — return empty
        return NextResponse.json([]);
      }
    }

    // Optional gameType filter ('R' = regular, 'D' = draft, 'P' = playoffs)
    const gameTypeParam = searchParams.get('gameType');
    if (gameTypeParam) {
      pipeline.push({ $match: { gameType: gameTypeParam } });
    }

    // Optional date-range filter (used to fetch only a visible window of games,
    // e.g. "last N game dates ± a few", instead of a whole season at once).
    const dateFromParam = searchParams.get('dateFrom');
    const dateToParam = searchParams.get('dateTo');
    if (dateFromParam || dateToParam) {
      const gameDateMatch: Record<string, Date> = {};
      if (dateFromParam) gameDateMatch.$gte = new Date(dateFromParam);
      if (dateToParam) gameDateMatch.$lte = new Date(dateToParam);
      pipeline.push({ $match: { gameDate: gameDateMatch } });
    }

    // Dates view - a cheap per-day summary (date, game count, whether any game that
    // day has a final result) used to figure out which date window to actually fetch
    // full game data for, without pulling every game in the season just to find out
    // which dates exist.
    if (view === 'dates') {
      pipeline.push(
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$gameDate' } },
            count: { $sum: 1 },
            hasFinal: { $max: { $cond: [{ $eq: ['$result.isFinal', true] }, true, false] } },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', count: 1, hasFinal: 1 } },
      );
      const dates = await db.collection('games').aggregate(pipeline, { allowDiskUse: true }).toArray();
      return NextResponse.json(dates);
    }

    // Summary view - exclude heavy fields
    if (view === 'summary') {
      pipeline.push({
        $project: {
          awayTeamRoster: 0,
          homeTeamRoster: 0,
          // 'result' (singular) is the live/current game result; 'results' (plural) is a
          // legacy audit-trail array used only by the batch-comparison tooling. Both can
          // carry the heavy per-player dailyStats blob, so both must be excluded here.
          'result.scores.players': 0,
          'results.scores.players': 0
        }
      });
    }

    // Head-to-head view - only the outcome fields needed to build a W/L matrix.
    // Skips roster/player-stat fields entirely and skips team population below,
    // since callers only need the raw team ObjectIds off winner/loser.
    if (view === 'headToHead') {
      pipeline.push({
        $project: {
          'result.isFinal': 1,
          'result.winner': 1,
          'result.loser': 1,
        }
      });
    }

    // Optional limit (used for existence checks)
    const limitParam = searchParams.get('limit');
    if (limitParam) pipeline.push({ $limit: parseInt(limitParam, 10) });

    const games = await db.collection('games').aggregate(pipeline, { allowDiskUse: true }).toArray();

    if (view === 'headToHead') {
      return NextResponse.json(games);
    }

    // Populate team references
    const teamIds = new Set<string>();
    games.forEach(game => {
      if (game.awayTeam) teamIds.add(game.awayTeam.toString());
      if (game.homeTeam) teamIds.add(game.homeTeam.toString());
      if (game.result?.winner) teamIds.add(game.result.winner.toString());
      if (game.result?.loser) teamIds.add(game.result.loser.toString());
    });

    const teams = await db.collection('ablteams')
      .find({ _id: { $in: Array.from(teamIds).map(id => new ObjectId(id)) } })
      .toArray();
    
    const teamMap = new Map(teams.map(t => [t._id.toString(), t]));

    // Populate teams in response
    games.forEach(game => {
      if (game.awayTeam) game.awayTeam = teamMap.get(game.awayTeam.toString());
      if (game.homeTeam) game.homeTeam = teamMap.get(game.homeTeam.toString());
      if (game.result?.winner) game.result.winner = teamMap.get(game.result.winner.toString());
      if (game.result?.loser) game.result.loser = teamMap.get(game.result.loser.toString());
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

      const game: any = {
        awayTeam: new ObjectId(gameDetails.awayTeam),
        homeTeam: new ObjectId(gameDetails.homeTeam),
        gameDate: new Date(gameDetails.gameDate),
        gameType: gameDetails.gameType || 'R'
      };

      if (gameDetails.description) game.description = gameDetails.description;
      if (gameDetails.seasonId) game.seasonId = new ObjectId(gameDetails.seasonId);
      if (gameDetails.leagueId) game.leagueId = new ObjectId(gameDetails.leagueId);

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
