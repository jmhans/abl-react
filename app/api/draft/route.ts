import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';

function toStringId(value: any): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toString();
}

async function getActiveDraft(db: any) {
  return db.collection('drafts').findOne({ status: 'active' }, { sort: { createdAt: -1 } });
}

async function hydrateDraft(db: any, draft: any) {
  if (!draft) return null;

  const playerIds = (draft.picks || [])
    .map((entry: any) => entry.playerId)
    .filter(Boolean)
    .map((id: string) => new ObjectId(id));

  const players = playerIds.length
    ? await db.collection('players_view').find({ _id: { $in: playerIds } }).toArray()
    : [];

  const playerMap = new Map(players.map((player: any) => [toStringId(player._id), player]));

  return {
    _id: toStringId(draft._id),
    status: draft.status,
    createdAt: draft.createdAt,
    completedAt: draft.completedAt || null,
    effectiveDate: draft.effectiveDate || null,
    orderIds: draft.orderIds || [],
    picks: (draft.picks || [])
      .map((entry: any) => {
        const player = playerMap.get(entry.playerId);
        if (!player) return null;
        return {
          pick: entry.pick,
          player,
          draftedAt: entry.draftedAt,
        };
      })
      .filter(Boolean),
  };
}

export async function GET() {
  try {
    const db = await connectToDatabase();
    const draft = await getActiveDraft(db);
    const hydrated = await hydrateDraft(db, draft);
    return NextResponse.json({ draft: hydrated });
  } catch (error) {
    console.error('Error fetching draft:', error);
    return NextResponse.json({ error: 'Failed to fetch draft' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { isAdmin, user } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const body = await request.json().catch(() => ({}));

    const teams = await db.collection('ablteams').find({}).toArray();
    const validTeamIds = teams.map((team: any) => toStringId(team._id));

    const providedOrder = Array.isArray(body.orderIds) ? body.orderIds.map(String) : validTeamIds;
    const orderSet = new Set(providedOrder);

    if (
      providedOrder.length !== validTeamIds.length ||
      validTeamIds.some((id: string) => !orderSet.has(id))
    ) {
      return NextResponse.json({ error: 'Invalid team orderIds' }, { status: 400 });
    }

    await db.collection('drafts').updateMany(
      { status: 'active' },
      { $set: { status: 'abandoned', completedAt: new Date() } }
    );

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

    await db.collection('lineups').deleteMany({});

    const insert = await db.collection('drafts').insertOne({
      status: 'active',
      orderIds: providedOrder,
      picks: [],
      createdAt: new Date(),
      createdBy: user?.sub || null,
    });

    const createdDraft = await db.collection('drafts').findOne({ _id: insert.insertedId });
    const hydrated = await hydrateDraft(db, createdDraft);

    return NextResponse.json({ draft: hydrated }, { status: 201 });
  } catch (error) {
    console.error('Error creating draft:', error);
    return NextResponse.json({ error: 'Failed to create new draft' }, { status: 500 });
  }
}
