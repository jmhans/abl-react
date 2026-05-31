import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState, getSessionUserFromCookies, isAdminUser } from '@/app/lib/admin-auth';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { calculateSuppDraftRounds, buildSuppDraftBoard } from '@/app/lib/supp-draft-utils';
import { getDraftEligiblePositions, DraftPlayer } from '@/app/lib/draft-utils';

function toStringId(value: any): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toString();
}

async function resolveFromParams(db: any, searchParams: URLSearchParams) {
  const leagueSlug = searchParams.get('league') || 'abl';
  const seasonSlug = searchParams.get('season') || 'active';
  return resolveLeagueContext(db, leagueSlug, seasonSlug);
}

async function hydrateSuppDraft(db: any, draft: any) {
  if (!draft) return null;

  const playerIds = (draft.picks || [])
    .map((entry: any) => entry.playerId)
    .filter(Boolean)
    .map((id: string) => new ObjectId(id));

  const players = playerIds.length
    ? await db.collection('players_view').find({ _id: { $in: playerIds } }).toArray()
    : [];

  const playerMap = new Map(players.map((p: any) => [toStringId(p._id), p]));

  return {
    _id: toStringId(draft._id),
    leagueId: draft.leagueId,
    seasonId: draft.seasonId,
    status: draft.status,
    scheduledAt: draft.scheduledAt ? draft.scheduledAt.toISOString?.() ?? draft.scheduledAt : null,
    rounds: draft.rounds ?? 3,
    orderIds: draft.orderIds || [],
    picks: (draft.picks || [])
      .map((entry: any) => {
        const player = playerMap.get(entry.playerId);
        if (!player) return null;
        return { pick: entry.pick, player, draftedAt: entry.draftedAt };
      })
      .filter(Boolean),
    dropIndications: (draft.dropIndications || []).map((d: any) => ({
      teamId: d.teamId,
      playerId: d.playerId,
      indicatedAt: d.indicatedAt,
    })),
    skippedTeams: (draft.skippedTeams || []).map(String),
    lockedUntilOverallPick: draft.lockedUntilOverallPick ?? null,
    createdAt: draft.createdAt,
    startedAt: draft.startedAt || null,
    completedAt: draft.completedAt || null,
  };
}

// GET /api/supp-draft?league=abl&season=2026
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { league, season } = await resolveFromParams(db, request.nextUrl.searchParams);

    const draft = await db.collection('supp_drafts').findOne(
      { leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    const hydrated = await hydrateSuppDraft(db, draft);
    return NextResponse.json({ draft: hydrated });
  } catch (error) {
    console.error('Error fetching supp draft:', error);
    return NextResponse.json({ error: 'Failed to fetch supp draft' }, { status: 500 });
  }
}

// POST /api/supp-draft — Admin creates a new supp draft (opens the pending / drop-indication window)
// Body: { league, season, scheduledAt? }
// orderIds are NOT set at creation — they are locked when the draft is started.
export async function POST(request: NextRequest) {
  try {
    const { isAdmin, user } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const body = await request.json().catch(() => ({}));
    const leagueSlug = body.league || 'abl';
    const seasonSlug = body.season || 'active';
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    // scheduledAt is optional at creation time; admin can update it later
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;

    // Abandon any existing pending/active supp drafts for this season
    await db.collection('supp_drafts').updateMany(
      {
        status: { $in: ['pending', 'active'] },
        leagueId: league._id.toString(),
        seasonId: season._id.toString(),
      },
      { $set: { status: 'abandoned', completedAt: new Date() } }
    );

    // orderIds are empty until the draft is started (locked at start time from live standings)
    const rounds = calculateSuppDraftRounds({});

    const insert = await db.collection('supp_drafts').insertOne({
      status: 'pending',
      leagueId: league._id.toString(),
      seasonId: season._id.toString(),
      year: season.year,
      orderIds: [],
      rounds,
      picks: [],
      dropIndications: [],
      scheduledAt,
      createdAt: new Date(),
      createdBy: user?.sub || null,
      startedAt: null,
      completedAt: null,
    });

    const created = await db.collection('supp_drafts').findOne({ _id: insert.insertedId });
    const hydrated = await hydrateSuppDraft(db, created);
    return NextResponse.json({ draft: hydrated }, { status: 201 });
  } catch (error) {
    console.error('Error creating supp draft:', error);
    return NextResponse.json({ error: 'Failed to create supp draft' }, { status: 500 });
  }
}

// PATCH /api/supp-draft — Admin updates scheduledAt, starts, reorders, or skips/unskips teams
// Body: { league, season, scheduledAt?, action?: 'start' | 'reorder' | 'skip' }
// 'skip' allows team owners to unskip their own team (skipped: false); all other actions require admin.
export async function PATCH(request: NextRequest) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const admin = isAdminUser(sessionUser);

    const db = await connectToDatabase();
    const body = await request.json().catch(() => ({}));
    const leagueSlug = body.league || 'abl';
    const seasonSlug = body.season || 'active';

    // Non-admin: only allowed to unskip their own team
    if (!admin && body.action !== 'skip') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    if (!admin && body.action === 'skip' && body.skipped !== false) {
      return NextResponse.json({ error: 'Only admin can skip a team' }, { status: 403 });
    }
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const draft = await db.collection('supp_drafts').findOne(
      {
        status: { $in: ['pending', 'active'] },
        leagueId: league._id.toString(),
        seasonId: season._id.toString(),
      },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No pending/active supp draft found' }, { status: 404 });
    }

    const updates: Record<string, any> = {};

    if (body.action === 'reorder') {
      // Reorder the draft (only on active draft, admin only — already checked above)
      if (draft.status !== 'active') {
        return NextResponse.json({ error: 'Can only reorder an active draft' }, { status: 400 });
      }
      const seasonTeamIds = (season.teamIds || []).map((id: any) => id.toString());
      if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
        return NextResponse.json({ error: 'orderIds required' }, { status: 400 });
      }
      const providedOrder: string[] = body.orderIds.map(String);
      const orderSet = new Set(providedOrder);
      if (
        providedOrder.length !== seasonTeamIds.length ||
        seasonTeamIds.some((id: string) => !orderSet.has(id))
      ) {
        return NextResponse.json({ error: 'Invalid team orderIds' }, { status: 400 });
      }
      updates.orderIds = providedOrder;
    }

    if (body.action === 'skip') {
      const { teamId, skipped } = body;
      if (!teamId || typeof skipped !== 'boolean') {
        return NextResponse.json(
          { error: 'teamId (string) and skipped (boolean) are required' },
          { status: 400 }
        );
      }
      if (draft.status !== 'active') {
        return NextResponse.json({ error: 'Can only skip/unskip teams in an active draft' }, { status: 400 });
      }
      // Non-admin: can only unskip their own team
      if (!admin) {
        const team = await db.collection('ablteams').findOne({ _id: new ObjectId(teamId) });
        const owns = (team?.owners ?? []).some((o: any) =>
          (o.userId && sessionUser.sub && o.userId === sessionUser.sub) ||
          (o.email && sessionUser.email && o.email.toLowerCase() === sessionUser.email?.toLowerCase())
        );
        if (!owns) {
          return NextResponse.json({ error: 'You do not own this team' }, { status: 403 });
        }
      }
      const current: string[] = (draft.skippedTeams || []).map(String);
      if (skipped) {
        updates.skippedTeams = [...new Set([...current, String(teamId)])];
        updates.lockedUntilOverallPick = null; // clear any stale lock
      } else {
        // Resuming: lock the current on-the-clock slot by its overallPick number so
        // the clock doesn't immediately jump back to this team's earlier missed slot.
        // Self-healing: once the locked slot is filled, the lock condition fails
        // naturally and normal board-order takes over (catching up to B's missed slots).
        const dropCountByTeam: Record<string, number> = {};
        for (const d of draft.dropIndications || []) {
          dropCountByTeam[d.teamId] = (dropCountByTeam[d.teamId] ?? 0) + 1;
        }
        const rounds = draft.rounds ?? calculateSuppDraftRounds(dropCountByTeam);
        const draftBoard = buildSuppDraftBoard((draft.orderIds || []).map(String), rounds);

        const filledSlotKeys = new Set(
          (draft.picks || [])
            .filter((p: any) => !p.forfeited)
            .map((p: any) => `${p.pick.teamId}:${p.pick.round}`)
        );
        // Treat the resuming team as still skipped when finding the current clock slot
        const skippedIncluding = new Set([...current, String(teamId)]);
        const clockSlot =
          draftBoard.find(
            (slot) =>
              !filledSlotKeys.has(`${slot.teamId}:${slot.round}`) &&
              !skippedIncluding.has(slot.teamId)
          ) ?? null;

        updates.skippedTeams = current.filter((id) => id !== String(teamId));
        updates.lockedUntilOverallPick = clockSlot?.overallPick ?? null;
      }
    }

    if (body.scheduledAt !== undefined) {
      updates.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    }

    if (body.action === 'start') {
      if (draft.status === 'active' && draft.startedAt) {
        return NextResponse.json({ error: 'Supp draft already started' }, { status: 409 });
      }

      // Lock the draft order — must be provided at start time so standings are current
      const seasonTeamIds = (season.teamIds || []).map((id: any) => id.toString());
      if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
        return NextResponse.json(
          { error: 'orderIds are required when starting the draft' },
          { status: 400 }
        );
      }
      const providedOrder: string[] = body.orderIds.map(String);
      const orderSet = new Set(providedOrder);
      if (
        providedOrder.length !== seasonTeamIds.length ||
        seasonTeamIds.some((id: string) => !orderSet.has(id))
      ) {
        return NextResponse.json({ error: 'Invalid team orderIds' }, { status: 400 });
      }
      updates.orderIds = providedOrder;

      // Lock rounds based on current drop indications
      const dropCountByTeam: Record<string, number> = {};
      for (const d of draft.dropIndications || []) {
        dropCountByTeam[d.teamId] = (dropCountByTeam[d.teamId] ?? 0) + 1;
      }
      updates.rounds = calculateSuppDraftRounds(dropCountByTeam);
      updates.status = 'active';
      updates.startedAt = new Date();
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    await db.collection('supp_drafts').updateOne({ _id: draft._id }, { $set: updates });

    const updated = await db.collection('supp_drafts').findOne({ _id: draft._id });
    const hydrated = await hydrateSuppDraft(db, updated);
    return NextResponse.json({ draft: hydrated });
  } catch (error) {
    console.error('Error updating supp draft:', error);
    return NextResponse.json({ error: 'Failed to update supp draft' }, { status: 500 });
  }
}

// DELETE /api/supp-draft — Admin deletes the supp draft
export async function DELETE(request: NextRequest) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const { league, season } = await resolveFromParams(db, request.nextUrl.searchParams);

    const draft = await db.collection('supp_drafts').findOne(
      { leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No supp draft found' }, { status: 404 });
    }

    await db.collection('supp_drafts').deleteOne({ _id: draft._id });
    return NextResponse.json({ deleted: true, draftId: draft._id.toString() });
  } catch (error) {
    console.error('Error deleting supp draft:', error);
    return NextResponse.json({ error: 'Failed to delete supp draft' }, { status: 500 });
  }
}
