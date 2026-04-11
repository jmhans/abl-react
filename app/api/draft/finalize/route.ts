import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { getNextRosterEffectiveDate } from '@/app/lib/roster-utils';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { getDraftEligiblePositions } from '@/app/lib/draft-utils';

function toObjectId(id: string) {
  return new ObjectId(id);
}

export async function POST(request: NextRequest) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const body = await request.json().catch(() => ({}));
    const leagueSlug = body.league || 'abl';
    const seasonSlug = body.season || 'active';
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);
    const draft = await db.collection('drafts').findOne(
      { status: 'active', leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No active draft found' }, { status: 404 });
    }

    const picks = draft.picks || [];
    if (picks.length === 0) {
      return NextResponse.json({ error: 'Draft has no picks' }, { status: 400 });
    }

    const effectiveDate = await getNextRosterEffectiveDate(db);

    const picksByTeam = new Map<string, any[]>();
    for (const entry of picks) {
      const teamId = String(entry.pick?.teamId || '');
      if (!teamId) continue;
      if (!picksByTeam.has(teamId)) picksByTeam.set(teamId, []);
      picksByTeam.get(teamId)!.push(entry);
    }

    // Fetch player data for all picks so we can set lineupPosition
    const allPlayerIds = picks
      .map((entry: { playerId?: string }) => entry.playerId)
      .filter(Boolean)
      .map((id: string) => new ObjectId(id));
    const players = allPlayerIds.length
      ? await db.collection('players_view').find({ _id: { $in: allPlayerIds } }).toArray()
      : [];
    const playerMap = new Map(players.map((p) => [p._id.toString(), p]));

    const lineupOps: any[] = [];
    for (const [teamId, teamPicks] of picksByTeam.entries()) {
      const sorted = [...teamPicks].sort((a, b) => a.pick.overallPick - b.pick.overallPick);
      const roster = sorted.map((entry, index) => {
        const player = playerMap.get(entry.playerId);
        const eligiblePositions = player ? getDraftEligiblePositions(player) : [];
        return {
          player: toObjectId(entry.playerId),
          lineupPosition: eligiblePositions.length > 0 ? eligiblePositions[0] : null,
          rosterOrder: index + 1,
          acqType: 'draft',
        };
      });

      lineupOps.push({
        updateOne: {
          filter: {
            ablTeam: toObjectId(teamId),
            effectiveDate,
          },
          update: {
            $set: {
              roster,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              ablTeam: toObjectId(teamId),
              effectiveDate,
            },
          },
          upsert: true,
        },
      });
    }

    if (lineupOps.length > 0) {
      await db.collection('lineups').bulkWrite(lineupOps);
    }

    await db.collection('drafts').updateOne(
      { _id: draft._id },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          effectiveDate,
        },
      }
    );

    return NextResponse.json({ success: true, lineupsCreated: lineupOps.length });
  } catch (error) {
    console.error('Error finalizing draft:', error);
    return NextResponse.json({ error: 'Failed to finalize draft' }, { status: 500 });
  }
}
