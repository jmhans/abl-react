import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getNextRosterEffectiveDate, isRosterLocked, getTimeUntilLock, calculateAblScore } from '@/app/lib/roster-utils';

// GET /api/teams/:id/roster - Get current roster for team
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await connectToDatabase();
    const { id: teamId } = await params;

    // Get next game's effective date
    const effectiveDate = await getNextRosterEffectiveDate(db);

    // Check if roster is locked
    const locked = await isRosterLocked(db);
    const timeUntilLock = await getTimeUntilLock(db);

    // Try to find roster for this effective date
    let lineup = await db.collection('lineups').findOne({
      ablTeam: new ObjectId(teamId),
      effectiveDate: effectiveDate
    });

    // If no roster exists for next game, get most recent roster to copy from
    if (!lineup) {
      const previousLineups = await db.collection('lineups')
        .find({ 
          ablTeam: new ObjectId(teamId),
          effectiveDate: { $lt: effectiveDate }
        })
        .sort({ effectiveDate: -1 })
        .limit(1)
        .toArray();

      if (previousLineups.length > 0) {
        // Create placeholder with copied roster
        lineup = {
          _id: new ObjectId(),
          ablTeam: new ObjectId(teamId),
          effectiveDate: effectiveDate,
          roster: previousLineups[0].roster,
          updatedAt: new Date()
        } as any;
      } else {
        // Brand new team, empty roster
        lineup = {
          _id: new ObjectId(),
          ablTeam: new ObjectId(teamId),
          effectiveDate: effectiveDate,
          roster: [],
          updatedAt: new Date()
        } as any;
      }
    }

    // Populate player details
    if (lineup && lineup.roster && lineup.roster.length > 0) {
      const playerIds = lineup.roster.map((r: any) => r.player);
      let players = await db.collection('players_view')
        .find({ _id: { $in: playerIds } })
        .toArray();

      // Calculate ABL scores and create player lookup map
      players = players.map((p: any) => ({
        ...p,
        abl: calculateAblScore(p.stats)
      }));

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

    // Get next game info
    const nextGames = await db.collection('games')
      .find({ 
        gameDate: { $gte: new Date() },
        gameType: 'R'
      })
      .sort({ gameDate: 1 })
      .limit(1)
      .toArray();

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
      roster: lineup.roster || [],
      updatedAt: lineup.updatedAt,
      locked: locked,
      timeUntilLock: timeUntilLock,
      nextGame: nextGames[0] || null
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

    const effectiveDate = await getNextRosterEffectiveDate(db);
    if (!effectiveDate) {
      return NextResponse.json(
        { error: 'No upcoming games scheduled' },
        { status: 404 }
      );
    }

    // Validate roster array
    if (!body.roster || !Array.isArray(body.roster)) {
      return NextResponse.json(
        { error: 'Invalid roster format' },
        { status: 400 }
      );
    }

    // Ensure all roster items have required fields and correct rosterOrder
    const roster = body.roster.map((item: any, index: number) => ({
      player: new ObjectId(item.player._id || item.player),
      lineupPosition: item.lineupPosition || null,
      rosterOrder: index + 1 // CRITICAL: Preserve exact order from frontend
    }));

    // RULE VALIDATION: Pickups must stay below all drafted players
    // Get all players to check acqType
    const playerIds = roster.map((r: any) => r.player);
    const players = await db.collection('players')
      .find({ _id: { $in: playerIds } })
      .toArray();
    
    const playerAcqMap = new Map(
      players.map((p: any) => [p._id.toString(), p.ablstatus?.acqType])
    );

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
