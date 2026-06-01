/**
 * POST /api/supp-draft/queue-pick
 *
 * Fires immediately when it's a team's turn and they have auto-draft enabled.
 * Unlike /auto-pick, this does NOT require the deadline to have expired.
 *
 * Auth: any authenticated user — the server validates that the on-clock team
 * is actually owned by the requesting user (or user is admin).
 */

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
import { resolveAutoPickCandidate } from '@/app/api/supp-draft/auto-pick/route';

export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const admin = isAdminUser(sessionUser);

    const body = await request.json().catch(() => ({}));
    const leagueSlug = String(body.league || 'abl');
    const seasonSlug = String(body.season || 'active');

    const db = await connectToDatabase();
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const draft = await db.collection('supp_drafts').findOne(
      { status: 'active', leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No active supp draft found' }, { status: 404 });
    }

    const result = await resolveAutoPickCandidate(db, draft, season);

    if (!result) {
      return NextResponse.json({ message: 'Draft is complete or pick already made' });
    }

    const onClockTeamId = result.currentPick.teamId;

    // Validate the requesting user owns the on-clock team (unless admin)
    if (!admin) {
      const team = await db.collection('ablteams').findOne({ _id: new ObjectId(onClockTeamId) });
      const owns = (team?.owners ?? []).some((o: any) =>
        (o.userId && sessionUser.sub && o.userId === sessionUser.sub) ||
        (o.email && sessionUser.email && o.email.toLowerCase() === sessionUser.email?.toLowerCase())
      );
      if (!owns) {
        return NextResponse.json({ error: 'You do not own the on-clock team' }, { status: 403 });
      }
    }

    // Confirm this team has auto-draft enabled
    const autoDraftTeams: string[] = (draft.autoDraftTeams || []).map(String);
    if (!admin && !autoDraftTeams.includes(onClockTeamId)) {
      return NextResponse.json({ error: 'Auto-draft is not enabled for this team' }, { status: 400 });
    }

    const pickedAt = new Date();
    await db.collection('supp_drafts').updateOne(
      { _id: draft._id },
      {
        $push: {
          picks: {
            pick: result.currentPick,
            playerId: result.playerId,
            draftedAt: pickedAt.toISOString(),
            autoPick: true,
            fromQueue: result.fromQueue ?? false,
          },
        },
      } as any
    );

    const dropCountByTeam: Record<string, number> = {};
    for (const d of draft.dropIndications || []) {
      dropCountByTeam[d.teamId] = (dropCountByTeam[d.teamId] ?? 0) + 1;
    }
    const rounds = draft.rounds ?? calculateSuppDraftRounds(dropCountByTeam);
    const draftBoard = buildSuppDraftBoard((draft.orderIds || []).map(String), rounds, dropCountByTeam);
    const filledSlotKeys = new Set(
      (draft.picks || [])
        .filter((p: any) => !p.forfeited)
        .map((p: any) => `${p.pick.teamId}:${p.pick.round}`)
    );
    const isCompletingDraft = filledSlotKeys.size + 1 >= draftBoard.length;

    const ptm: number = draft.pickTimeMinutes ?? DEFAULT_PICK_TIME_MINUTES;
    await db.collection('supp_drafts').updateOne(
      { _id: draft._id },
      {
        $set: isCompletingDraft
          ? { status: 'completed', completedAt: pickedAt, pickDeadlineAt: null }
          : { pickDeadlineAt: computePickDeadline(pickedAt, ptm) },
      } as any
    );

    return NextResponse.json({
      message: 'Queue pick made',
      playerId: result.playerId,
      playerName: result.playerName,
      pick: result.currentPick,
      fromQueue: result.fromQueue ?? false,
    });
  } catch (error) {
    console.error('Queue-pick error:', error);
    return NextResponse.json({ error: 'Queue pick failed' }, { status: 500 });
  }
}
