import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { resolveLeagueContext } from '@/app/lib/league-context';

function toStringId(value: any): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toString();
}

async function getDraftForSeason(db: any, leagueId: any, seasonId: any) {
  // Find the most-recent completed or active draft tied to this season.
  // Falls back to any draft with matching leagueId when seasonId doesn't match
  // (e.g. draft saved under wrong season — handled by fix-draft-2026 script).
  const draft = await db.collection('drafts').findOne(
    { leagueId: leagueId.toString(), seasonId: seasonId.toString() },
    { sort: { createdAt: -1 } }
  );
  return draft;
}

async function getActiveDraftForSeason(db: any, leagueId: any, seasonId: any) {
  return db.collection('drafts').findOne(
    { status: 'active', leagueId: leagueId.toString(), seasonId: seasonId.toString() },
    { sort: { createdAt: -1 } }
  );
}

// Resolve league+season from query params (league=abl&season=2026 or defaults to active)
async function resolveFromParams(db: any, searchParams: URLSearchParams) {
  const leagueSlug = searchParams.get('league') || 'abl';
  const seasonSlug = searchParams.get('season') || 'active';
  return resolveLeagueContext(db, leagueSlug, seasonSlug);
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
    startedAt: draft.startedAt || null,
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

export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { league, season } = await resolveFromParams(db, request.nextUrl.searchParams);
    // Return the most recent draft for this season (active or completed)
    const draft = await getDraftForSeason(db, league._id, season._id);
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

    const { league, season } = await resolveFromParams(db, request.nextUrl.searchParams);

    const seasonTeamIds = (season.teamIds || []).map((id: any) => id.toString());
    const teams = seasonTeamIds.length
      ? await db.collection('ablteams').find({ _id: { $in: seasonTeamIds.map((id: string) => new ObjectId(id)) } }).toArray()
      : await db.collection('ablteams').find({}).toArray();
    const validTeamIds = teams.map((team: any) => toStringId(team._id));

    const providedOrder = Array.isArray(body.orderIds) ? body.orderIds.map(String) : validTeamIds;
    const orderSet = new Set(providedOrder);

    if (
      providedOrder.length !== validTeamIds.length ||
      validTeamIds.some((id: string) => !orderSet.has(id))
    ) {
      return NextResponse.json({ error: 'Invalid team orderIds' }, { status: 400 });
    }

    // Abandon any existing active drafts for this season
    await db.collection('drafts').updateMany(
      { status: 'active', leagueId: league._id.toString(), seasonId: season._id.toString() },
      { $set: { status: 'abandoned', completedAt: new Date() } }
    );

    // NOTE: Do NOT delete lineups here. Lineup history must never be destroyed
    // by draft creation. Lineups are managed independently.

    const insert = await db.collection('drafts').insertOne({
      status: 'active',
      leagueId: league._id.toString(),
      seasonId: season._id.toString(),
      year: season.year,
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

export async function DELETE(request: NextRequest) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const { league, season } = await resolveFromParams(db, request.nextUrl.searchParams);

    const draft = await db.collection('drafts').findOne(
      { leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No draft found for this league/season' }, { status: 404 });
    }

    await db.collection('drafts').deleteOne({ _id: draft._id });

    // Scope lineup deletion strictly to the teams in this season — never wipe all lineups.
    const seasonDoc = await db.collection('seasons').findOne({ _id: new ObjectId(season._id.toString()) });
    const seasonTeamObjectIds = (seasonDoc?.teamIds || []).map((id: any) =>
      typeof id === 'string' ? new ObjectId(id) : id
    );
    if (seasonTeamObjectIds.length > 0) {
      await db.collection('lineups').deleteMany({ ablTeam: { $in: seasonTeamObjectIds } });
    }

    return NextResponse.json({ deleted: true, draftId: draft._id.toString() });
  } catch (error) {
    console.error('Error deleting draft:', error);
    return NextResponse.json({ error: 'Failed to delete draft' }, { status: 500 });
  }
}
