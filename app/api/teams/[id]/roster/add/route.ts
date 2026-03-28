import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getNextRosterEffectiveDate, isRosterLocked } from '@/app/lib/roster-utils';

// POST /api/teams/:id/roster/add - Add player to roster
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await connectToDatabase();
    const { id: teamId } = await params;
    const body = await request.json();

    const { playerId, position, acqType } = body;

    if (!playerId) {
      return NextResponse.json(
        { error: 'playerId is required' },
        { status: 400 }
      );
    }

    // Check if roster is locked
    const locked = await isRosterLocked(db);
    if (locked) {
      return NextResponse.json(
        { error: 'Roster is locked for next game' },
        { status: 403 }
      );
    }

    const effectiveDate = await getNextRosterEffectiveDate(db);

    // Get player to verify exists and get eligible positions
    const player = await db.collection('players').findOne({ _id: new ObjectId(playerId) });
    if (!player) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      );
    }

    // Check if player already on a roster
    if (player.ablstatus?.onRoster && player.ablstatus?.ablTeam) {
      return NextResponse.json(
        { error: 'Player is already on a roster', team: player.ablstatus.ablTeam },
        { status: 409 }
      );
    }

    // Get current roster (or copy from previous)
    let lineup = await db.collection('lineups').findOne({
      ablTeam: new ObjectId(teamId),
      effectiveDate: effectiveDate
    }) as any;

    if (!lineup) {
      // No roster for next game yet, copy from most recent
      const previousLineups = await db.collection('lineups')
        .find({ 
          ablTeam: new ObjectId(teamId),
          effectiveDate: { $lt: effectiveDate }
        })
        .sort({ effectiveDate: -1 })
        .limit(1)
        .toArray();

      lineup = {
        _id: new ObjectId(),
        ablTeam: new ObjectId(teamId),
        effectiveDate: effectiveDate,
        roster: previousLineups[0]?.roster || [],
        updatedAt: new Date()
      } as any;
    }

    if (!lineup) {
      return NextResponse.json({ error: 'Failed to prepare roster' }, { status: 500 });
    }

    // RULE: Check that team has IL player with matching position
    const ilPlayerIds = lineup.roster
      .filter((r: any) => r.lineupPosition === 'INJ' || r.lineupPosition === 'NA')
      .map((r: any) => r.player);

    if (ilPlayerIds.length === 0) {
      return NextResponse.json(
        { error: 'No IL players on roster. Cannot add free agents without IL player.' },
        { status: 403 }
      );
    }

    // Get IL player eligible positions
    const ilPlayers = await db.collection('players_view')
      .find({ _id: { $in: ilPlayerIds } })
      .toArray();

    const ilPositions = new Set<string>();
    ilPlayers.forEach((p: any) => {
      if (Array.isArray(p.eligible)) {
        p.eligible.forEach((pos: string) => {
          ilPositions.add(pos);
        });
      }
    });

    // Get new player eligible positions from players_view (has correct eligible array)
    const newPlayerFromView = await db.collection('players_view').findOne({ _id: new ObjectId(playerId) });
    const newPlayerEligible = newPlayerFromView?.eligible || player.eligible || [];

    // Check if new player matches any IL position
    const hasMatchingPosition = newPlayerEligible.some((pos: string) => ilPositions.has(pos));
    if (!hasMatchingPosition) {
      return NextResponse.json(
        { 
          error: `Player is not eligible for any IL positions. IL positions: ${Array.from(ilPositions).join(', ')}`,
          ilPositions: Array.from(ilPositions),
          playerEligible: newPlayerEligible
        },
        { status: 403 }
      );
    }

    // Determine position - use provided position, or first eligible position matching IL
    let lineupPosition = position;
    if (!lineupPosition) {
      // Try to use first matching IL position, otherwise first eligible
      lineupPosition = newPlayerEligible.find((pos: string) => ilPositions.has(pos)) || newPlayerEligible[0];
    }

    // Add player to end of roster with next rosterOrder
    const nextRosterOrder = lineup.roster.length + 1;
    lineup.roster.push({
      player: new ObjectId(playerId),
      lineupPosition: lineupPosition,
      rosterOrder: nextRosterOrder
    });
    lineup.updatedAt = new Date();

    // Update lineup document
    await db.collection('lineups').updateOne(
      { 
        ablTeam: new ObjectId(teamId),
        effectiveDate: effectiveDate
      },
      {
        $set: {
          roster: lineup.roster,
          updatedAt: lineup.updatedAt
        },
        $setOnInsert: {
          ablTeam: new ObjectId(teamId),
          effectiveDate: effectiveDate
        }
      },
      { upsert: true }
    );

    // Update player ownership
    await db.collection('players').updateOne(
      { _id: new ObjectId(playerId) },
      {
        $set: {
          'ablstatus.ablTeam': new ObjectId(teamId),
          'ablstatus.onRoster': true,
          'ablstatus.acqType': acqType || 'fa' // 'draft', 'fa', 'trade', etc.
        }
      }
    );

    // Populate player data for response
    const updatedPlayer = await db.collection('players').findOne({ _id: new ObjectId(playerId) });

    return NextResponse.json({
      success: true,
      player: updatedPlayer,
      rosterOrder: nextRosterOrder,
      lineupPosition: lineupPosition,
      effectiveDate: effectiveDate
    });

  } catch (error) {
    console.error('Error adding player to roster:', error);
    return NextResponse.json(
      { error: 'Failed to add player', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
