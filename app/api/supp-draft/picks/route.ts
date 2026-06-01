import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getSessionUserFromCookies, isAdminUser } from '@/app/lib/admin-auth';
import { resolveLeagueContext } from '@/app/lib/league-context';
import {
  buildSuppDraftBoard,
  calculateSuppDraftRounds,
  computePickDeadline,
  DEFAULT_PICK_TIME_MINUTES,
} from '@/app/lib/supp-draft-utils';

function toStringId(value: any): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toString();
}

async function hydrateSuppDraft(db: any, draft: any) {
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
    status: draft.status,
    orderIds: draft.orderIds || [],
    rounds: draft.rounds ?? 3,
    picks: (draft.picks || [])
      .map((entry: any) => {
        const player = playerMap.get(entry.playerId);
        if (!player) return null;
        return { pick: entry.pick, player, draftedAt: entry.draftedAt };
      })
      .filter(Boolean),
    dropIndications: draft.dropIndications || [],
  };
}

// POST /api/supp-draft/picks
// Body: { league, season, playerId }
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

    const draft = await db.collection('supp_drafts').findOne(
      { status: 'active', leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No active supp draft found' }, { status: 404 });
    }

    // Check player not already picked in supp draft
    const alreadyPicked = (draft.picks || []).some((entry: any) => entry.playerId === playerId);
    if (alreadyPicked) {
      return NextResponse.json({ error: 'Player already picked in supp draft' }, { status: 409 });
    }

    // Check player not in a regular draft pick for another team (can be on a roster as pickup or drop-indicated)
    // This is handled by the players endpoint — here we just ensure not already supp-drafted

    // Build the draft board from current state
    const dropCountByTeam: Record<string, number> = {};
    for (const d of draft.dropIndications || []) {
      dropCountByTeam[d.teamId] = (dropCountByTeam[d.teamId] ?? 0) + 1;
    }
    const rounds = draft.rounds ?? calculateSuppDraftRounds(dropCountByTeam);
    const draftBoard = buildSuppDraftBoard((draft.orderIds || []).map(String), rounds, dropCountByTeam);

    // Skip-aware: find the current pick, honoring any lock set when a team resumed.
    // lockedUntilOverallPick holds the overallPick number of the slot that was on the
    // clock when someone hit Resume. We keep that slot as currentPick until it is
    // filled; after that the condition fails and we fall back to normal board-order
    // (which will jump back to the resumed team's earliest missed slot automatically).
    const lockedUntilOverallPick: number | null = draft.lockedUntilOverallPick ?? null;
    const filledSlotKeys = new Set(
      (draft.picks || [])
        .filter((p: any) => !p.forfeited)
        .map((p: any) => `${p.pick.teamId}:${p.pick.round}`)
    );
    const skippedTeamSet = new Set((draft.skippedTeams || []).map(String));

    // Find the locked slot object (if the lock is still valid)
    const lockedSlot =
      lockedUntilOverallPick !== null
        ? draftBoard.find((slot) => slot.overallPick === lockedUntilOverallPick) ?? null
        : null;
    const lockIsActive =
      lockedSlot !== null &&
      !filledSlotKeys.has(`${lockedSlot.teamId}:${lockedSlot.round}`) &&
      !skippedTeamSet.has(lockedSlot.teamId);

    const currentPick = lockIsActive
      ? lockedSlot!
      : (draftBoard.find(
          (slot) =>
            !filledSlotKeys.has(`${slot.teamId}:${slot.round}`) &&
            !skippedTeamSet.has(slot.teamId)
        ) ?? null);

    if (!currentPick) {
      return NextResponse.json({ error: 'Supp draft is already complete' }, { status: 400 });
    }

    // Authorization: only the on-clock team's owner(s) or admin
    if (!admin) {
      const teamIdValue = ObjectId.isValid(currentPick.teamId)
        ? new ObjectId(currentPick.teamId)
        : currentPick.teamId;
      const onClockTeam = await db.collection('ablteams').findOne({ _id: teamIdValue } as any);
      const owners: Array<{ userId?: string; email?: string }> = onClockTeam?.owners ?? [];
      const ownsTeam = owners.some(
        (o) =>
          (o.userId && sessionUser.sub && o.userId === sessionUser.sub) ||
          (o.email && sessionUser.email && o.email.toLowerCase() === sessionUser.email?.toLowerCase())
      );
      if (!ownsTeam) {
        return NextResponse.json(
          { error: 'You are not the owner of the team on the clock' },
          { status: 403 }
        );
      }
    }

    await db.collection('supp_drafts').updateOne(
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

    const isCompletingDraft = filledSlotKeys.size + 1 >= draftBoard.length;

    // Refresh the pick deadline for the next pick
    const pickDraftedAt = new Date();
    const ptm: number = draft.pickTimeMinutes ?? DEFAULT_PICK_TIME_MINUTES;
    await db.collection('supp_drafts').updateOne(
      { _id: draft._id },
      {
        $set: isCompletingDraft
          ? { status: 'completed', completedAt: pickDraftedAt, pickDeadlineAt: null }
          : { pickDeadlineAt: computePickDeadline(pickDraftedAt, ptm) },
      } as any
    );

    const updatedDraft = await db.collection('supp_drafts').findOne({ _id: draft._id });
    const hydrated = await hydrateSuppDraft(db, updatedDraft);

    return NextResponse.json({ draft: hydrated });
  } catch (error) {
    console.error('Error making supp draft pick:', error);
    return NextResponse.json({ error: 'Failed to make supp draft pick' }, { status: 500 });
  }
}

// DELETE /api/supp-draft/picks — Undo the last supp draft pick (admin only)
export async function DELETE(request: NextRequest) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (!sessionUser || !isAdminUser(sessionUser)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const body = await request.json().catch(() => ({}));
    const leagueSlug = String(body.league || 'abl');
    const seasonSlug = String(body.season || 'active');
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const draft = await db.collection('supp_drafts').findOne(
      { status: 'active', leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No active supp draft found' }, { status: 404 });
    }

    const picks: any[] = draft.picks || [];
    if (picks.length === 0) {
      return NextResponse.json({ error: 'No picks to undo' }, { status: 400 });
    }

    const newPicks = picks.slice(0, -1);
    await db.collection('supp_drafts').updateOne(
      { _id: draft._id },
      { $set: { picks: newPicks } }
    );

    const updatedDraft = await db.collection('supp_drafts').findOne({ _id: draft._id });
    const hydrated = await hydrateSuppDraft(db, updatedDraft);
    return NextResponse.json({ draft: hydrated });
  } catch (error) {
    console.error('Error undoing supp draft pick:', error);
    return NextResponse.json({ error: 'Failed to undo pick' }, { status: 500 });
  }
}
