import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { calculateGameResult } from '@/app/lib/game-utils';

// POST /api/games/batch - Batch process games with new scoring logic
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateStart = searchParams.get('dateStart');
    const dateEnd = searchParams.get('dateEnd');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const action = searchParams.get('action') || 'process'; // 'process' or 'dryrun'
    const skipAlreadyProcessed = searchParams.get('skipAlreadyProcessed') !== 'false';

    const db = await connectToDatabase();

    // Build query
    const query: any = {};
    if (dateStart || dateEnd) {
      query.gameDate = {};
      if (dateStart) query.gameDate.$gte = new Date(dateStart);
      if (dateEnd) query.gameDate.$lte = new Date(dateEnd);
    }

    // When skipping already-processed games, fetch only games that already have a result
    if (skipAlreadyProcessed) {
      query['result'] = { $exists: false };
    }

    // Get games to process
    const games = await db
      .collection('games')
      .find(query)
      .sort({ gameDate: 1, _id: 1 })
      .limit(limit)
      .allowDiskUse(true)
      .toArray();

    const results = {
      total: games.length,
      processed: 0,
      skipped: 0,
      errors: [],
      summary: [] as any[]
    };

    // Process each game
    for (const game of games) {
      try {
        // Get rosters - check root level first, then fallback to stored result
        let homeTeamRoster = game.homeTeamRoster;
        let awayTeamRoster = game.awayTeamRoster;
        let homeOpponentErrors: number | undefined;
        let awayOpponentErrors: number | undefined;

        // If rosters not at root, extract from stored result
        if ((!homeTeamRoster || homeTeamRoster.length === 0) && game.result?.scores) {
          const storedResult = game.result;
          if (storedResult.scores && storedResult.scores.length >= 2) {
            const homeScore = storedResult.scores.find((s: any) =>
              s.location === 'H' || s.team.toString() === game.homeTeam.toString()
            );
            const awayScore = storedResult.scores.find((s: any) =>
              s.location === 'A' || s.team.toString() === game.awayTeam.toString()
            );

            if (homeScore?.players) homeTeamRoster = homeScore.players;
            if (awayScore?.players) awayTeamRoster = awayScore.players;

            const homeOppEFromStored = homeScore?.final?.opp_e ?? homeScore?.regulation?.opp_e;
            const awayOppEFromStored = awayScore?.final?.opp_e ?? awayScore?.regulation?.opp_e;
            if (typeof homeOppEFromStored === 'number') homeOpponentErrors = homeOppEFromStored;
            if (typeof awayOppEFromStored === 'number') awayOpponentErrors = awayOppEFromStored;
          }
        }

        // Skip if still no rosters
        if (!homeTeamRoster || !awayTeamRoster || homeTeamRoster.length === 0 || awayTeamRoster.length === 0) {
          results.skipped++;
          results.summary.push({
            gameId: game._id.toString(),
            status: 'skipped',
            reason: 'missing rosters'
          });
          continue;
        }

        // Calculate result
        const calcResult = await calculateGameResult(
          db,
          game._id.toString(),
          game.homeTeam.toString(),
          game.awayTeam.toString(),
          homeTeamRoster,
          awayTeamRoster,
          {
            homeOpponentErrors,
            awayOpponentErrors
          }
        );

        // In dry-run mode, don't save to DB
        if (action === 'process') {
          await db.collection('games').updateOne(
            { _id: game._id },
            { $set: { result: calcResult } }
          );
        }

        results.processed++;
        results.summary.push({
          gameId: game._id.toString(),
          status: 'processed',
          homeTeamScore: calcResult.scores[0].final,
          awayTeamScore: calcResult.scores[1].final,
          winner: calcResult.winner.toString(),
          action: action
        });
      } catch (error) {
        results.errors.push({
          gameId: game._id.toString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        results.summary.push({
          gameId: game._id.toString(),
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return NextResponse.json(results, { status: 200 });
  } catch (error) {
    console.error('Error in batch processing:', error);
    return NextResponse.json(
      {
        error: 'Batch processing failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
