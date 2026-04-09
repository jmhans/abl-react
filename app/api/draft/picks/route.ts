import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { buildDraftBoard } from '@/app/lib/draft-utils';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { getSessionUserFromCookies, isAdminUser } from '@/app/lib/admin-auth';

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

export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (!sessionUser) {
      return NextResponse.json({ error: 'You must be signed in to make a pick' }, { status: 401 });
    }
    const admin = isAdminUser(sessionUser);

    const body = await request.json();
    const playerId = String(body.playerId || '');
    const leagueSlug = String(body.league || 'abl');
    const seasonSlug = String(body.season || 'active');

    if (!playerId || !ObjectId.isValid(playerId)) {
      return NextResponse.json({ error: 'Valid playerId is required' }, { status: 400 });
    }

    const db = await connectToDatabase();
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);
    const draft = await db.collection('drafts').findOne(
      { status: 'active', leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No active draft found' }, { status: 404 });
    }

    const alreadyPicked = (draft.picks || []).some((entry: any) => entry.playerId === playerId);
    if (alreadyPicked) {
      return NextResponse.json({ error: 'Player already drafted' }, { status: 409 });
    }

    const draftBoard = buildDraftBoard((draft.orderIds || []).map(String));
    const currentPick = draftBoard[(draft.picks || []).length];

    if (!currentPick) {
      return NextResponse.json({ error: 'Draft is already complete' }, { status: 400 });
    }

    // Only the on-clock team's owner(s) or an admin may submit a pick
    if (!admin) {
      const teamIdValue = ObjectId.isValid(currentPick.teamId) ? new ObjectId(currentPick.teamId) : currentPick.teamId;
      const onClockTeam = await db.collection('ablteams').findOne({ _id: teamIdValue } as any);
      const owners: Array<{ email?: string }> = onClockTeam?.owners ?? [];
      const ownsTeam = owners.some(
        (o) => o.email && sessionUser.email && o.email.toLowerCase() === sessionUser.email.toLowerCase()
      );
      if (!ownsTeam) {
        return NextResponse.json({ error: 'You are not the owner of the team on the clock' }, { status: 403 });
      }
    }

    await db.collection('drafts').updateOne(
      { _id: draft._id },
      {
        $push: {
          picks: {
            pick: currentPick,
            playerId,
            draftedAt: new Date().toISOString(),
          },
        },
      } as any
    );

    const updatedDraft = await db.collection('drafts').findOne({ _id: draft._id });
    const hydrated = await hydrateDraft(db, updatedDraft);

    return NextResponse.json({ draft: hydrated });
  } catch (error) {
    console.error('Error drafting player:', error);
    return NextResponse.json({ error: 'Failed to draft player' }, { status: 500 });
  }
}
