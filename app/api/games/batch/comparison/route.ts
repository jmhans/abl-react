import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/games/batch/comparison - Compare new vs legacy scoring
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all'; // 'all', 'matches', 'mismatches'
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const db = await connectToDatabase();

    // Get games with results array (length >= 2)
    const games = await db
      .collection('games')
      .find({
        results: { $exists: true, $type: 'array' },
        $expr: { $gte: [{ $size: '$results' }, 2] }
      })
      .limit(limit)
      .toArray();

    const comparison = {
      total: games.length,
      matches: 0,
      mismatches: 0,
      details: [] as any[]
    };

    // Compare each game's results[0] (newest) vs results[last] (original legacy)
    for (const game of games) {
      const newResult = game.results[0];
      const legacyResult = game.results[game.results.length - 1]; // Get oldest/original

      if (!newResult || !legacyResult) continue;

      // Extract scores
      const newHomeScore = newResult.scores?.[0]?.final || 0;
      const newAwayScore = newResult.scores?.[1]?.final || 0;
      
      // Legacy structure uses regulation.abl_runs or final.abl_runs for calculated score
      const legacyHomeScore = legacyResult.scores?.[0]?.final?.abl_runs 
        || legacyResult.scores?.[0]?.regulation?.abl_runs 
        || 0;
      const legacyAwayScore = legacyResult.scores?.[1]?.final?.abl_runs 
        || legacyResult.scores?.[1]?.regulation?.abl_runs 
        || 0;

      // Compare
      const homeMatch = Math.abs(newHomeScore - legacyHomeScore) < 0.01;
      const awayMatch = Math.abs(newAwayScore - legacyAwayScore) < 0.01;
      const isMatch = homeMatch && awayMatch;

      if (isMatch) {
        comparison.matches++;
      } else {
        comparison.mismatches++;
      }

      // Filter based on status param
      if (status === 'matches' && !isMatch) continue;
      if (status === 'mismatches' && isMatch) continue;

      // Get team info for display
      const homeTeam = await db.collection('ablteams').findOne({ _id: new ObjectId(game.homeTeam) });
      const awayTeam = await db.collection('ablteams').findOne({ _id: new ObjectId(game.awayTeam) });

      comparison.details.push({
        gameId: game._id.toString(),
        gameDate: game.gameDate,
        homeTeam: homeTeam?.nickname || 'Unknown',
        awayTeam: awayTeam?.nickname || 'Unknown',
        newScores: {
          home: newHomeScore,
          away: newAwayScore,
          homePoints: newResult.scores?.[0]?.regulation?.abl_points,
          awayPoints: newResult.scores?.[1]?.regulation?.abl_points,
          winner: newResult.winner?.toString()
        },
        legacyScores: {
          home: legacyHomeScore,
          away: legacyAwayScore,
          homePoints: legacyResult.scores?.[0]?.final?.abl_points || legacyResult.scores?.[0]?.regulation?.abl_points,
          awayPoints: legacyResult.scores?.[1]?.final?.abl_points || legacyResult.scores?.[1]?.regulation?.abl_points,
          winner: legacyResult.winner?.toString()
        },
        deltas: {
          home: (newHomeScore - legacyHomeScore).toFixed(2),
          away: (newAwayScore - legacyAwayScore).toFixed(2)
        },
        match: isMatch,
        newCalculatedAt: newResult.calculatedAt,
        legacyCalculatedAt: legacyResult.calculatedAt
      });
    }

    return NextResponse.json(comparison, { status: 200 });
  } catch (error) {
    console.error('Error in batch comparison:', error);
    return NextResponse.json(
      {
        error: 'Batch comparison failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
