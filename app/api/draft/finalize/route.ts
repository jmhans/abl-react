import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { getNextRosterEffectiveDate } from '@/app/lib/roster-utils';

function toObjectId(id: string) {
  return new ObjectId(id);
}

export async function POST() {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const draft = await db.collection('drafts').findOne({ status: 'active' }, { sort: { createdAt: -1 } });

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

    const lineupOps: any[] = [];
    for (const [teamId, teamPicks] of picksByTeam.entries()) {
      const sorted = [...teamPicks].sort((a, b) => a.pick.overallPick - b.pick.overallPick);
      const roster = sorted.map((entry, index) => ({
        player: toObjectId(entry.playerId),
        lineupPosition: null,
        rosterOrder: index + 1,
      }));

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

    await db.collection('players').updateMany(
      {},
      {
        $set: {
          'ablstatus.ablTeam': null,
          'ablstatus.onRoster': false,
          'ablstatus.acqType': null,
        },
      }
    );

    const playerOps = picks.map((entry: any) => ({
      updateOne: {
        filter: { _id: toObjectId(entry.playerId) },
        update: {
          $set: {
            'ablstatus.ablTeam': toObjectId(entry.pick.teamId),
            'ablstatus.onRoster': true,
            'ablstatus.acqType': 'draft',
          },
        },
      },
    }));

    if (playerOps.length > 0) {
      await db.collection('players').bulkWrite(playerOps);
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
