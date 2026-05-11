import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getNextRosterGameDate, isRosterLocked } from '@/app/lib/roster-utils';
import { getAdminAuthState } from '@/app/lib/admin-auth';

// POST /api/teams/:id/roster/add - Add player to roster
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await connectToDatabase();
    const { id: teamId } = await params;
    const body = await request.json();

    const { playerId, position, acqType, adminOverride, effectiveDate: requestedEffectiveDate } = body;

    if (!playerId) {
      return NextResponse.json(
        { error: 'playerId is required' },
        { status: 400 }
      );
    }

    // If adminOverride is requested, verify the caller is actually an admin
    let isAdminRequest = false;
    if (adminOverride) {
      const { isAdmin } = await getAdminAuthState();
      if (!isAdmin) {
        return NextResponse.json(
          { error: 'Admin access required for adminOverride' },
          { status: 403 }
        );
      }
      isAdminRequest = true;
    }

    // Admins can supply a back-dated effectiveDate; validate format YYYY-MM-DD
    let effectiveDate: string;
    if (isAdminRequest && requestedEffectiveDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedEffectiveDate)) {
        return NextResponse.json(
          { error: 'effectiveDate must be YYYY-MM-DD' },
          { status: 400 }
        );
      }
      effectiveDate = requestedEffectiveDate;
    } else {
      // Check if roster is locked (only for non-backdated adds)
      const locked = await isRosterLocked(db);
      if (locked) {
        return NextResponse.json(
          { error: 'Roster is locked for next game' },
          { status: 403 }
        );
      }
      effectiveDate = await getNextRosterGameDate(db);
    }

    // Get player to verify exists and get eligible positions
    const player = await db.collection('players').findOne({ _id: new ObjectId(playerId) });
    if (!player) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      );
    }

    // Check if player is already on a roster in the same league.
    // Scope to this team's league by finding the season that contains teamId.
    const teamObjectId = new ObjectId(teamId);
    const thisSeason = await db.collection('seasons').findOne(
      { teamIds: teamObjectId },
      { projection: { teamIds: 1 } }
    );
    const leagueTeamIds: ObjectId[] = (thisSeason?.teamIds ?? [teamObjectId]).map((id: ObjectId | string) => {
      if (id instanceof ObjectId) return id;
      try {
        return new ObjectId(id);
      } catch {
        throw new Error(`Invalid season teamId for roster lookup: ${id}`);
      }
    });

    // Only check each team's most recent roster snapshot at or before this effective date.
    // This avoids false "already on roster" matches from historical lineup documents.
    const existingLineups = await db.collection('lineups').aggregate([
      {
        $match: {
          ablTeam: { $in: leagueTeamIds },
          effectiveDate: { $lte: effectiveDate },
        },
      },
      { $sort: { effectiveDate: -1 } },
      { $group: { _id: '$ablTeam', roster: { $first: '$roster' } } },
      { $match: { roster: { $elemMatch: { player: new ObjectId(playerId) } } } },
      { $project: { _id: 0, ablTeam: '$_id' } },
      { $limit: 1 },
    ]).toArray();
    const existingLineup = existingLineups[0] || null;
    if (existingLineup) {
      return NextResponse.json(
        { error: 'Player is already on a roster', team: existingLineup.ablTeam },
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
    // Admins can bypass this requirement
    if (!isAdminRequest) {
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
        rosterOrder: nextRosterOrder,
        acqType: acqType || 'fa',
      });
    } else {
      // Admin path: skip IL check, use provided position or first eligible
      const newPlayerFromView = await db.collection('players_view').findOne({ _id: new ObjectId(playerId) });
      const newPlayerEligible = newPlayerFromView?.eligible || player.eligible || [];

      let lineupPosition = position;
      if (!lineupPosition) {
        if (newPlayerEligible.length === 0) {
          return NextResponse.json(
            { error: 'Player has no eligible positions' },
            { status: 400 }
          );
        }
        lineupPosition = newPlayerEligible[0];
      }

      // Add player to end of roster with next rosterOrder
      const nextRosterOrder = lineup.roster.length + 1;
      lineup.roster.push({
        player: new ObjectId(playerId),
        lineupPosition: lineupPosition,
        rosterOrder: nextRosterOrder,
        acqType: acqType || 'fa',
      });
    }
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

    // When back-dating, also carry the player forward onto all future lineup docs
    // that don't already include them.
    const addedEntry = lineup.roster[lineup.roster.length - 1];
    if (isAdminRequest && requestedEffectiveDate) {
      const futureLineups = await db.collection('lineups')
        .find({
          ablTeam: new ObjectId(teamId),
          effectiveDate: { $gt: effectiveDate },
          'roster.player': { $ne: new ObjectId(playerId) },
        })
        .toArray();

      if (futureLineups.length > 0) {
        const bulkOps = futureLineups.map((fl: any) => {
          const nextOrder = fl.roster.length + 1;
          return {
            updateOne: {
              filter: { _id: fl._id },
              update: {
                $push: {
                  roster: {
                    player: new ObjectId(playerId),
                    lineupPosition: addedEntry.lineupPosition,
                    rosterOrder: nextOrder,
                    acqType: addedEntry.acqType,
                  },
                },
                $set: { updatedAt: new Date() },
              },
            },
          };
        });
        await db.collection('lineups').bulkWrite(bulkOps as any);
      }
    }

    // Populate player data for response
    const updatedPlayer = await db.collection('players').findOne({ _id: new ObjectId(playerId) });
    const forwardCount = isAdminRequest && requestedEffectiveDate
      ? (await db.collection('lineups').countDocuments({
          ablTeam: new ObjectId(teamId),
          effectiveDate: { $gt: effectiveDate },
          'roster.player': new ObjectId(playerId),
        }))
      : 0;

    const response: Record<string, unknown> = {
      success: true,
      player: updatedPlayer,
      rosterOrder: addedEntry.rosterOrder,
      lineupPosition: addedEntry.lineupPosition,
      effectiveDate: effectiveDate
    };
    if (isAdminRequest && requestedEffectiveDate) {
      response.forwardPropagated = forwardCount;
    }
    return NextResponse.json(response);

  } catch (error) {
    console.error('Error adding player to roster:', error);
    return NextResponse.json(
      { error: 'Failed to add player', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
