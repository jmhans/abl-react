import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';

function toStringId(value: any): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toString();
}

async function hydrateDraft(db: any, draft: any) {
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

export async function POST() {
  try {
    const db = await connectToDatabase();
    const draft = await db.collection('drafts').findOne({ status: 'active' }, { sort: { createdAt: -1 } });

    if (!draft) {
      return NextResponse.json({ error: 'No active draft found' }, { status: 404 });
    }

    const picks = draft.picks || [];
    if (picks.length === 0) {
      return NextResponse.json({ error: 'No picks to undo' }, { status: 400 });
    }

    const updatedPicks = picks.slice(0, -1);

    await db.collection('drafts').updateOne(
      { _id: draft._id },
      { $set: { picks: updatedPicks } }
    );

    const updatedDraft = await db.collection('drafts').findOne({ _id: draft._id });
    const hydrated = await hydrateDraft(db, updatedDraft);

    return NextResponse.json({ draft: hydrated });
  } catch (error) {
    console.error('Error undoing pick:', error);
    return NextResponse.json({ error: 'Failed to undo pick' }, { status: 500 });
  }
}
