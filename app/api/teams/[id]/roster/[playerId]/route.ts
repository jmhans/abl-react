import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getNextRosterEffectiveDate, isRosterLocked } from '@/app/lib/roster-utils';

// DELETE /api/teams/:id/roster/:playerId - Drop player from roster
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  try {
    const db = await connectToDatabase();
    const { id: teamId, playerId } = await params;

    // Check if roster is locked
    const locked = await isRosterLocked(db);
    if (locked) {
      return NextResponse.json(
        { error: 'Roster is locked for next game' },
        { status: 403 }
      );
    }

    const effectiveDate = await getNextRosterEffectiveDate(db);

    // Get current roster
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

      if (!previousLineups[0]) {
        return NextResponse.json(
          { error: 'No roster found' },
          { status: 404 }
        );
      }

      lineup = {
        _id: new ObjectId(),
        ablTeam: new ObjectId(teamId),
        effectiveDate: effectiveDate,
        roster: previousLineups[0].roster,
        updatedAt: new Date()
      } as any;
    }

    if (!lineup) {
      return NextResponse.json({ error: 'Failed to prepare roster' }, { status: 500 });
    }

    // Get player to check acqType
    const player = await db.collection('players').findOne({ _id: new ObjectId(playerId) });
    if (!player) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      );
    }

    // RULE: Cannot drop drafted players (only pickups)
    if (player.ablstatus?.acqType === 'draft' || player.ablstatus?.acqType === 'supp_draft') {
      return NextResponse.json(
        { error: 'Cannot drop drafted players', acqType: player.ablstatus.acqType },
        { status: 403 }
      );
    }

    // Find and remove player from roster
    const playerObjId = new ObjectId(playerId);
    const originalLength = lineup.roster.length;
    lineup.roster = lineup.roster.filter((r: any) => 
      !r.player.equals(playerObjId)
    );

    if (lineup.roster.length === originalLength) {
      return NextResponse.json(
        { error: 'Player not found on roster' },
        { status: 404 }
      );
    }

    // CRITICAL: Re-index rosterOrder to maintain continuity
    // When a player is dropped, close the gap in rosterOrder
    lineup.roster = lineup.roster
      .sort((a: any, b: any) => a.rosterOrder - b.rosterOrder)
      .map((r: any, index: number) => ({
        ...r,
        rosterOrder: index + 1
      }));

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

    // Update player ownership - clear team assignment
    await db.collection('players').updateOne(
      { _id: new ObjectId(playerId) },
      {
        $set: {
          'ablstatus.ablTeam': null,
          'ablstatus.onRoster': false
        }
      }
    );

    // Get dropped player info for response
    const droppedPlayer = await db.collection('players').findOne({ 
      _id: new ObjectId(playerId) 
    });

    return NextResponse.json({
      success: true,
      droppedPlayer: droppedPlayer,
      remainingRosterSize: lineup.roster.length,
      effectiveDate: effectiveDate
    });

  } catch (error) {
    console.error('Error dropping player from roster:', error);
    return NextResponse.json(
      { error: 'Failed to drop player', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
