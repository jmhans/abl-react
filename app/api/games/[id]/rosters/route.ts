import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

const EMPTY_SCORE = {
  ab: 0,
  h: 0,
  hr: 0,
  e: 0,
  abl_runs: 0,
};

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeLineScore(score: any) {
  if (typeof score === 'number') {
    return {
      ...EMPTY_SCORE,
      abl_runs: toNumber(score, 0),
    };
  }

  if (!score || typeof score !== 'object') {
    return { ...EMPTY_SCORE };
  }

  return {
    ...EMPTY_SCORE,
    ...score,
    ab: toNumber(score.ab, 0),
    h: toNumber(score.h, 0),
    hr: toNumber(score.hr, 0),
    e: toNumber(score.e, 0),
    abl_runs: toNumber(score.abl_runs ?? score.final, 0),
  };
}

function sumPlayerStat(players: any[], stat: string): number {
  return players.reduce((sum, player) => {
    if (!player?.playedPosition) return sum;
    const value = player?.dailyStats?.[stat];
    return sum + toNumber(value, 0);
  }, 0);
}

function normalizeTeamScore(score: any) {
  const players = Array.isArray(score?.players) ? score.players : [];
  return {
    regulation: normalizeLineScore(score?.regulation),
    final: {
      ...normalizeLineScore(score?.final),
      ab: toNumber(score?.final?.ab, toNumber(score?.regulation?.ab, sumPlayerStat(players, 'ab'))),
      h: toNumber(score?.final?.h, toNumber(score?.regulation?.h, sumPlayerStat(players, 'h'))),
      hr: toNumber(score?.final?.hr, toNumber(score?.regulation?.hr, sumPlayerStat(players, 'hr'))),
      e: toNumber(score?.final?.e, toNumber(score?.regulation?.e, sumPlayerStat(players, 'e'))),
      abl_runs: toNumber(
        score?.final?.abl_runs,
        toNumber(score?.regulation?.abl_runs, toNumber(score?.final, 0))
      ),
    },
  };
}

// GET /api/games/:id/rosters - Get game rosters with calculated scores
// This endpoint reads pre-computed game results from the game document
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();

    // Get game with results
    const game = await db.collection('games').findOne({ _id: new ObjectId(id) });
    
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Populate teams
    const teams = await db.collection('ablteams')
      .find({ _id: { $in: [game.homeTeam, game.awayTeam] } })
      .toArray();
    
    const teamMap = new Map(teams.map(t => [t._id.toString(), t]));
    const homeTeam = teamMap.get(game.homeTeam.toString());
    const awayTeam = teamMap.get(game.awayTeam.toString());

    // Check if game has a pre-computed result
    if (!game.result || !game.result.scores) {
      return NextResponse.json({
        homeTeam: [],
        awayTeam: [],
        home_score: normalizeTeamScore(null),
        away_score: normalizeTeamScore(null),
        result: {},
        status: 'scheduled'
      });
    }

    // Extract the single stored result
    const latestResult = game.result;
    
    // Find home and away scores by matching team ID
    const homeScore = latestResult.scores.find((s: any) => 
      s.team.toString() === game.homeTeam.toString()
    );
    const awayScore = latestResult.scores.find((s: any) => 
      s.team.toString() === game.awayTeam.toString()
    );

    if (!homeScore || !awayScore) {
      return NextResponse.json({
        homeTeam: [],
        awayTeam: [],
        home_score: normalizeTeamScore(null),
        away_score: normalizeTeamScore(null),
        result: {},
        status: 'scheduled'
      });
    }

    // Flatten player structure - the game document has nested player objects
    // Transform: { player: { _id, name, ... }, dailyStats, ... } 
    // Into: { _id, name, position, dailyStats, ... }
    const flattenPlayers = (players: any[]) => {
      return players.map((p: any) => ({
        _id: p.player?._id || p._id,
        name: p.player?.name || p.name,
        position: p.player?.eligible?.[0] || p.position,
        playedPosition: p.playedPosition,
        lineupOrder: p.lineupOrder,
        lineupPosition: p.lineupPosition,
        dailyStats: p.dailyStats
      }));
    };

    // Return the pre-computed data
    // Status set to 'live' since we have results (game has been played)
    return NextResponse.json({
      homeTeam: flattenPlayers(homeScore.players || []),
      awayTeam: flattenPlayers(awayScore.players || []),
      home_score: normalizeTeamScore(homeScore),
      away_score: normalizeTeamScore(awayScore),
      result: {
        winner: homeTeam && latestResult.winner?.toString() === game.homeTeam.toString() ? homeTeam : awayTeam,
        loser: homeTeam && latestResult.winner?.toString() === game.homeTeam.toString() ? awayTeam : homeTeam
      },
      status: latestResult.status || 'live'
    });
  } catch (error) {
    console.error('Error fetching game rosters:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game rosters', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// PUT /api/games/:id/rosters - Set game rosters from team roster documents
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();
    const body = await request.json();

    // Get game
    const game = await db.collection('games').findOne({ _id: new ObjectId(id) });

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Option 1: Accept rosters directly in request body
    if (body.homeTeamRoster && body.awayTeamRoster) {
      const updateResult = await db.collection('games').findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            homeTeamRoster: body.homeTeamRoster,
            awayTeamRoster: body.awayTeamRoster,
            rostersUpdatedAt: new Date()
          }
        },
        { returnDocument: 'after' }
      );

      if (!updateResult) {
        return NextResponse.json({ error: 'Failed to update game' }, { status: 500 });
      }

      return NextResponse.json(updateResult.value, { status: 200 });
    }

    // Option 2: Fetch rosters from team roster documents for the game date
    const gameDate = new Date(game.gameDate);
    const gameNoonCT = new Date(
      gameDate.getFullYear(),
      gameDate.getMonth(),
      gameDate.getDate(),
      12,
      0,
      0
    );

    // Get the effective date (noon CT on game day or before)
    const rosters = await db
      .collection('rosters')
      .find({
        $or: [
          {
            ablTeam: game.homeTeam,
            effectiveDate: { $lte: gameNoonCT }
          },
          {
            ablTeam: game.awayTeam,
            effectiveDate: { $lte: gameNoonCT }
          }
        ]
      })
      .sort({ effectiveDate: -1 })
      .limit(2)
      .toArray();

    const homeRoster = rosters.find(r => r.ablTeam.toString() === game.homeTeam.toString());
    const awayRoster = rosters.find(r => r.ablTeam.toString() === game.awayTeam.toString());

    if (!homeRoster || !awayRoster) {
      return NextResponse.json(
        {
          error: 'Could not find rosters for both teams',
          found: {
            home: !!homeRoster,
            away: !!awayRoster
          }
        },
        { status: 400 }
      );
    }

    // Extract roster items (flatten from the roster document structure)
    const homeTeamRoster = homeRoster.roster?.map((item: any) => ({
      player: item.player?._id || item.player,
      lineupPosition: item.lineupPosition,
      rosterOrder: item.rosterOrder
    })) || [];

    const awayTeamRoster = awayRoster.roster?.map((item: any) => ({
      player: item.player?._id || item.player,
      lineupPosition: item.lineupPosition,
      rosterOrder: item.rosterOrder
    })) || [];

    // Update game with rosters
    const updateResult = await db.collection('games').findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          homeTeamRoster,
          awayTeamRoster,
          rostersUpdatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!updateResult) {
      return NextResponse.json({ error: 'Failed to update game' }, { status: 500 });
    }

    return NextResponse.json(updateResult.value, { status: 200 });
  } catch (error) {
    console.error('Error updating game rosters:', error);
    return NextResponse.json(
      {
        error: 'Failed to update game rosters',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
