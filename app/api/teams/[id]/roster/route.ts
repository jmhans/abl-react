import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getNextRosterGameDate, getNextRosterLockTime, isRosterLocked, getTimeUntilLock, calculateAblScore, getFirstMlbGameTimeForDate, SEASON_START } from '@/app/lib/roster-utils';

// GET /api/teams/:id/roster?asOf=YYYY-MM-DD - Get roster for team (current or historical)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await connectToDatabase();
    const { id: teamId } = await params;

    // Optional asOf date for historical roster view (YYYY-MM-DD)
    const { searchParams } = new URL(request.url);
    const asOfParam = searchParams.get('asOf');
    const asOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : null;

    let gameDate: string;
    let lockTime: string;
    let locked: boolean;
    let timeUntilLock: number | null;

    if (asOf) {
      // Historical view: lock time is the first game start on that date
      gameDate = asOf;
      const lockTimeDate = await getFirstMlbGameTimeForDate(db, asOf);
      lockTime = lockTimeDate.toISOString();
      // Historical dates are always considered locked (their lock time has passed)
      locked = new Date() >= lockTimeDate;
      const remaining = lockTimeDate.getTime() - Date.now();
      timeUntilLock = remaining > 0 ? remaining : null;
    } else {
      // Current view
      gameDate = await getNextRosterGameDate(db);
      lockTime = await getNextRosterLockTime(db);
      locked = await isRosterLocked(db);
      timeUntilLock = await getTimeUntilLock(db);
    }

    // Find the most recent lineup on or before the next game date.
    // This shows the current roster even when no changes have been made yet
    // for the upcoming game day.
    let lineup = await db.collection('lineups')
      .find({
        ablTeam: new ObjectId(teamId),
        effectiveDate: { $lte: gameDate }
      })
      .sort({ effectiveDate: -1 })
      .limit(1)
      .toArray()
      .then((docs: any[]) => docs[0] || null);

    if (!lineup) {
      // Truly no roster history for this team — start empty
      lineup = {
        _id: new ObjectId(),
        ablTeam: new ObjectId(teamId),
        effectiveDate: gameDate,
        roster: [],
        updatedAt: new Date()
      } as any;
    }

    // Populate player details
    if (lineup && lineup.roster && lineup.roster.length > 0) {
      const playerIds = lineup.roster.map((r: any) => r.player);
      let players = await db.collection('players_view')
        .find({ _id: { $in: playerIds } })
        .toArray();

      // Calculate ABL scores and create player lookup map.
      // Strip stats that pre-date the current season (e.g. an IL player who
      // still has last year's stats stored) so the roster shows accurate
      // 2026-season numbers only.
      players = players.map((p: any) => {
        const lastUpdate = p.lastStatUpdate ? new Date(p.lastStatUpdate) : null;
        const statsAreStale = !lastUpdate || lastUpdate < SEASON_START;
        const stats = statsAreStale ? undefined : p.stats;
        return {
          ...p,
          stats,
          abl: calculateAblScore(stats),
        };
      });

      const playerMap = new Map(players.map((p: any) => [p._id.toString(), p]));

      // Attach player details to roster, preserving rosterOrder
      lineup.roster = lineup.roster
        .map((r: any) => ({
          ...r,
          player: playerMap.get(r.player.toString())
        }))
        .filter((r: any) => r.player) // Remove any missing players
        .sort((a: any, b: any) => a.rosterOrder - b.rosterOrder); // Ensure correct order
    }

    // Get next game info (only relevant for current view)
    let nextGame = null;
    if (!asOf) {
      const nextGames = await db.collection('games')
        .find({ 
          gameDate: { $gte: new Date() },
          gameType: 'R'
        })
        .sort({ gameDate: 1 })
        .limit(1)
        .toArray();
      nextGame = nextGames[0] || null;
    }

    if (!lineup) {
      return NextResponse.json(
        { error: 'Failed to load roster' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      _id: lineup._id,
      ablTeam: lineup.ablTeam,
      effectiveDate: lineup.effectiveDate,
      lockTime: lockTime,
      roster: lineup.roster || [],
      updatedAt: lineup.updatedAt,
      locked: locked,
      timeUntilLock: timeUntilLock,
      nextGameDate: gameDate,
      nextGame: nextGame,
      asOf: asOf ?? null,
    });

  } catch (error) {
    console.error('Error fetching roster:', error);
    return NextResponse.json(
      { error: 'Failed to fetch roster', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// PUT /api/teams/:id/roster - Update roster (reorder or change positions)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await connectToDatabase();
    const { id: teamId } = await params;
    const body = await request.json();

    // Check if roster is locked
    const locked = await isRosterLocked(db);
    if (locked) {
      return NextResponse.json(
        { error: 'Roster is locked for next game' },
        { status: 403 }
      );
    }

    const effectiveDate = await getNextRosterGameDate(db);

    // Validate roster array
    if (!body.roster || !Array.isArray(body.roster)) {
      return NextResponse.json(
        { error: 'Invalid roster format' },
        { status: 400 }
      );
    }

    // RULE VALIDATION: Pickups must stay below all drafted players
    // Fetch existing lineup to get acqTypes BEFORE building roster array
    const existingLineup = await db.collection('lineups').findOne({ 
      ablTeam: new ObjectId(teamId),
      effectiveDate: effectiveDate
    });

    const playerAcqMap = new Map(
      (existingLineup?.roster || []).map((r: any) => [r.player.toString(), r.acqType])
    );

    // Ensure all roster items have required fields and correct rosterOrder.
    // CRITICAL: preserve acqType from the existing lineup so it is never stripped on save.
    const roster = body.roster.map((item: any, index: number) => {
      const playerId = new ObjectId(item.player._id || item.player);
      const acqType = item.acqType || playerAcqMap.get(playerId.toString()) || undefined;
      return {
        player: playerId,
        lineupPosition: item.lineupPosition || null,
        rosterOrder: index + 1, // CRITICAL: Preserve exact order from frontend
        ...(acqType !== undefined ? { acqType } : {}),
      };
    });

    // Find the highest drafted player position and lowest pickup position
    let highestDraftedPos = -1;
    let lowestPickupPos = Infinity;

    roster.forEach((r: any, index: number) => {
      const acqType = playerAcqMap.get(r.player.toString());
      if (acqType === 'draft' || acqType === 'supp_draft') {
        highestDraftedPos = Math.max(highestDraftedPos, index);
      } else if (acqType === 'fa' || acqType === 'trade') {
        lowestPickupPos = Math.min(lowestPickupPos, index);
      }
    });

    // If any pickup is above any drafted player, reject
    if (lowestPickupPos < highestDraftedPos) {
      return NextResponse.json(
        { 
          error: 'Pickups cannot be placed above drafted players in roster order',
          rule: 'Drafted players must appear first in roster order'
        },
        { status: 400 }
      );
    }

    // Update or create lineup document
    const result = await db.collection('lineups').updateOne(
      { 
        ablTeam: new ObjectId(teamId),
        effectiveDate: effectiveDate
      },
      {
        $set: {
          roster: roster,
          updatedAt: new Date()
        },
        $setOnInsert: {
          ablTeam: new ObjectId(teamId),
          effectiveDate: effectiveDate
        }
      },
      { upsert: true }
    );

    // Fetch updated roster with populated players
    const updatedLineup = await db.collection('lineups').findOne({
      ablTeam: new ObjectId(teamId),
      effectiveDate: effectiveDate
    });

    if (updatedLineup && updatedLineup.roster) {
      const playerIds = updatedLineup.roster.map((r: any) => r.player);
      const players = await db.collection('players')
        .find({ _id: { $in: playerIds } })
        .toArray();

      const playerMap = new Map(players.map((p: any) => [p._id.toString(), p]));
      
      updatedLineup.roster = updatedLineup.roster
        .map((r: any) => ({
          ...r,
          player: playerMap.get(r.player.toString())
        }))
        .sort((a: any, b: any) => a.rosterOrder - b.rosterOrder);
    }

    return NextResponse.json({
      success: true,
      lineup: updatedLineup,
      modified: result.modifiedCount > 0,
      created: result.upsertedCount > 0
    });

  } catch (error) {
    console.error('Error updating roster:', error);
    return NextResponse.json(
      { error: 'Failed to update roster', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
