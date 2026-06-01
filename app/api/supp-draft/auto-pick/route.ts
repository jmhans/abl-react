/**
 * POST /api/supp-draft/auto-pick
 *
 * Triggered by the client when the pick timer expires (and we are outside quiet hours).
 * Idempotent: if the current pick has already been filled since the client last polled,
 * the request succeeds silently.
 *
 * Auto-pick algorithm:
 *  1. Get the on-clock team's current roster (existing lineup + supp picks so far).
 *  2. Count players per eligible position.  OF target is 3 slots; all others are 1.
 *     Effective need = (target - currentCount), clamped to ≥ 0.
 *  3. Find the position(s) with the highest unmet need.
 *  4. From the available player pool at those positions (active, ≥ 25 ABs), pick
 *     the player with the highest ABL score.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getSessionUserFromCookies, isAdminUser } from '@/app/lib/admin-auth';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { calculateAblScore } from '@/app/lib/roster-utils';
import { getDraftEligiblePositions } from '@/app/lib/draft-utils';
import {
  buildSuppDraftBoard,
  calculateSuppDraftRounds,
  computePickDeadline,
  isQuietTime,
  DEFAULT_PICK_TIME_MINUTES,
} from '@/app/lib/supp-draft-utils';

const SEASON_START = new Date('2026-03-26T00:00:00Z');

function currentSeasonStats(p: any): any {
  const lastUpdate = p.lastStatUpdate ? new Date(p.lastStatUpdate) : null;
  if (!lastUpdate || lastUpdate < SEASON_START) return undefined;
  return p.stats;
}

// Positions considered for need analysis (DH excluded — it fills itself).
// OF is normalized by 2.25 to account for its multi-slot flexibility.
const OF_DIVISOR = 2.25;
const NEED_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF'];

// ---------------------------------------------------------------------------
// Shared helper: resolves the on-clock pick + top candidate without committing.
// Returns null if the draft is complete or no candidate is found.
// ---------------------------------------------------------------------------
interface AutoPickResult {
  currentPick: any;
  playerId: string;
  playerName: string;
  positions: string[];
  ablScore: number;
  fromQueue?: boolean;
}

export async function resolveAutoPickCandidate(db: any, draft: any, season: any): Promise<AutoPickResult | null> {
  const dropCountByTeam: Record<string, number> = {};
  for (const d of draft.dropIndications || []) {
    dropCountByTeam[d.teamId] = (dropCountByTeam[d.teamId] ?? 0) + 1;
  }
  const rounds = draft.rounds ?? calculateSuppDraftRounds(dropCountByTeam);
  const draftBoard = buildSuppDraftBoard((draft.orderIds || []).map(String), rounds, dropCountByTeam);

  const lockedUntilOverallPick: number | null = draft.lockedUntilOverallPick ?? null;
  const filledSlotKeys = new Set(
    (draft.picks || [])
      .filter((p: any) => !p.forfeited)
      .map((p: any) => `${p.pick.teamId}:${p.pick.round}`)
  );
  const skippedTeamSet = new Set((draft.skippedTeams || []).map(String));

  const lockedSlot = lockedUntilOverallPick !== null
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

  if (!currentPick) return null;
  if (filledSlotKeys.has(`${currentPick.teamId}:${currentPick.round}`)) return null;

  const onClockTeamId = currentPick.teamId;

  // --- Check queue first ---
  const alreadySuppPickedForQueue = new Set<string>(
    (draft.picks || [])
      .filter((p: any) => !p.forfeited && p.playerId)
      .map((p: any) => String(p.playerId))
  );

  const queue: string[] = (draft.draftQueues?.[onClockTeamId] ?? []).map(String);
  if (queue.length > 0) {
    // Need to know which players are locked league-wide to validate queue picks
    const dropIndicatedForQueue = new Set<string>(
      (draft.dropIndications || []).map((d: any) => d.playerId)
    );
    const seasonTeamObjectIdsForQueue = (season.teamIds || []).map((id: any) =>
      typeof id === 'string' ? new ObjectId(id) : id
    );
    const allLineups = await db.collection('lineups').aggregate([
      { $match: { ablTeam: { $in: seasonTeamObjectIdsForQueue } } },
      { $sort: { effectiveDate: -1 } },
      { $group: { _id: '$ablTeam', roster: { $first: '$roster' } } },
    ]).toArray();
    const lockedForQueue = new Set<string>();
    for (const lu of allLineups) {
      for (const r of lu.roster ?? []) {
        const pid = r.player.toString();
        if ((r.acqType === 'draft' || r.acqType === 'supp_draft') && !dropIndicatedForQueue.has(pid)) {
          lockedForQueue.add(pid);
        }
      }
    }

    // Walk the queue and pick the first player that's still available
    for (const queuedPlayerId of queue) {
      if (alreadySuppPickedForQueue.has(queuedPlayerId)) continue;
      if (lockedForQueue.has(queuedPlayerId)) continue;
      // Fetch the player doc to confirm they're still active
      let playerDoc: any = null;
      try {
        playerDoc = await db.collection('players_cache').findOne({ _id: new ObjectId(queuedPlayerId) })
          ?? await db.collection('players_view').findOne({ _id: new ObjectId(queuedPlayerId) });
      } catch { continue; }
      if (!playerDoc) continue;
      if (playerDoc.status !== 'Active') continue;
      return {
        currentPick,
        playerId: queuedPlayerId,
        playerName: playerDoc.name ?? playerDoc.fullName ?? 'Unknown',
        positions: (playerDoc.eligible ?? []) as string[],
        ablScore: Math.round(calculateAblScore(currentSeasonStats(playerDoc)) * 10) / 10,
        fromQueue: true,
      };
    }
  }

  // --- Fall back to algo ---
  const teamObjectId = ObjectId.isValid(onClockTeamId) ? new ObjectId(onClockTeamId) : onClockTeamId;

  const latestLineup = await db.collection('lineups').aggregate([
    { $match: { ablTeam: teamObjectId } },
    { $sort: { effectiveDate: -1 } },
    { $limit: 1 },
  ]).toArray();

  const dropIndicatedIds = new Set<string>(
    (draft.dropIndications || []).map((d: any) => String(d.playerId))
  );

  const existingRosterPlayerIds = new Set<string>(
    (latestLineup[0]?.roster ?? [])
      .filter((r: any) => (r.acqType === 'draft' || r.acqType === 'supp_draft') && !dropIndicatedIds.has(r.player.toString()))
      .map((r: any) => r.player.toString())
  );
  for (const p of draft.picks || []) {
    if (!p.forfeited && p.pick?.teamId === onClockTeamId && p.playerId) {
      existingRosterPlayerIds.add(String(p.playerId));
    }
  }

  const rosterDocs = existingRosterPlayerIds.size > 0
    ? await db.collection('players_view')
        .find({ _id: { $in: [...existingRosterPlayerIds].map((id) => new ObjectId(id)) } })
        .toArray()
    : [];

  const posCounts: Record<string, number> = {};
  for (const player of rosterDocs) {
    const eligible: string[] = (player.eligible ?? getDraftEligiblePositions(player)) as string[];
    for (const pos of eligible) {
      const key = pos.toUpperCase();
      posCounts[key] = (posCounts[key] ?? 0) + 1;
    }
  }

  // Normalize each position's count; OF divided by 2.25 to reflect multi-slot flexibility.
  // Find the position(s) with the lowest normalized count — those are the most needed.
  const normalizedCounts: Record<string, number> = {};
  for (const pos of NEED_POSITIONS) {
    const raw = posCounts[pos] ?? 0;
    normalizedCounts[pos] = pos === 'OF' ? raw / OF_DIVISOR : raw;
  }

  const minCount = Math.min(...Object.values(normalizedCounts));
  const neededPositions = Object.entries(normalizedCounts)
    .filter(([, count]) => count === minCount)
    .map(([pos]) => pos);

  const alreadySuppPicked = new Set<string>(
    (draft.picks || [])
      .filter((p: any) => !p.forfeited && p.playerId)
      .map((p: any) => String(p.playerId))
  );

  const dropIndicatedPlayerIds = new Set<string>(
    (draft.dropIndications || []).map((d: any) => d.playerId)
  );
  const seasonTeamObjectIds = (season.teamIds || []).map((id: any) =>
    typeof id === 'string' ? new ObjectId(id) : id
  );
  const latestLineups = await db.collection('lineups').aggregate([
    { $match: { ablTeam: { $in: seasonTeamObjectIds } } },
    { $sort: { effectiveDate: -1 } },
    { $group: { _id: '$ablTeam', roster: { $first: '$roster' } } },
  ]).toArray();

  const lockedPlayerIds = new Set<string>();
  for (const lu of latestLineups) {
    for (const r of lu.roster ?? []) {
      const pid = r.player.toString();
      if ((r.acqType === 'draft' || r.acqType === 'supp_draft') && !dropIndicatedPlayerIds.has(pid)) {
        lockedPlayerIds.add(pid);
      }
    }
  }

  const cacheCount = await db.collection('players_cache').estimatedDocumentCount();
  const sourceCollection = cacheCount > 0 ? 'players_cache' : 'players_view';

  type ScoredPlayer = { doc: any; abl: number };

  const buildCandidates = (docs: any[], requireABs: boolean): ScoredPlayer[] =>
    docs
      .filter((p: any) => {
        const pid = p._id.toString();
        return !alreadySuppPicked.has(pid) && !lockedPlayerIds.has(pid);
      })
      .flatMap((p: any) => {
        const stats = currentSeasonStats(p);
        if (requireABs && (stats?.batting?.atBats ?? 0) < 25) return [];
        return [{ doc: p, abl: calculateAblScore(stats) }];
      });

  let availablePlayers = await db.collection(sourceCollection).find({
    status: 'Active',
    eligible: { $in: neededPositions },
    'stats.batting.atBats': { $gte: 25 },
  }).toArray();

  let candidates = buildCandidates(availablePlayers, true);

  if (candidates.length === 0) {
    availablePlayers = await db.collection(sourceCollection).find({
      status: 'Active',
      eligible: { $in: neededPositions },
    }).toArray();
    candidates = buildCandidates(availablePlayers, false);
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.abl - a.abl);
  const best = candidates[0];

  return {
    currentPick,
    playerId: best.doc._id.toString(),
    playerName: best.doc.name ?? best.doc.fullName ?? 'Unknown',
    positions: (best.doc.eligible ?? []) as string[],
    ablScore: Math.round(best.abl * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// GET /api/supp-draft/auto-pick?league=X&season=Y
// Returns the player who would be auto-picked right now (no side effects).
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const leagueSlug = searchParams.get('league') || 'abl';
    const seasonSlug = searchParams.get('season') || 'active';

    const db = await connectToDatabase();
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const draft = await db.collection('supp_drafts').findOne(
      { status: 'active', leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ preview: null });
    }

    const result = await resolveAutoPickCandidate(db, draft, season);
    return NextResponse.json({ preview: result });
  } catch (error) {
    console.error('Auto-pick preview error:', error);
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/supp-draft/auto-pick
// Triggered by the client when the pick timer expires (outside quiet hours).
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

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

    // --- Verify the timer has actually expired server-side ---
    const deadline = draft.pickDeadlineAt ? new Date(draft.pickDeadlineAt) : null;
    const now = new Date();

    if (!deadline) {
      return NextResponse.json({ error: 'No pick deadline set' }, { status: 400 });
    }
    if (now < deadline) {
      return NextResponse.json({ error: 'Pick timer has not expired yet' }, { status: 400 });
    }
    if (isQuietTime(now)) {
      return NextResponse.json({ error: 'Timer does not expire during quiet hours' }, { status: 400 });
    }

    const result = await resolveAutoPickCandidate(db, draft, season);

    if (!result) {
      // Draft is complete or slot already filled
      await db.collection('supp_drafts').updateOne(
        { _id: draft._id },
        { $set: { status: 'completed', completedAt: new Date() } } as any
      );
      return NextResponse.json({ message: 'Draft is complete or pick already made' });
    }

    const { currentPick, playerId: chosenPlayerId } = result;

    const pickedAt = new Date();
    await db.collection('supp_drafts').updateOne(
      { _id: draft._id },
      {
        $push: {
          picks: {
            pick: currentPick,
            playerId: chosenPlayerId,
            draftedAt: pickedAt.toISOString(),
            autoPick: true,
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

    // Refresh deadline for the next pick
    const ptm: number = draft.pickTimeMinutes ?? DEFAULT_PICK_TIME_MINUTES;
    await db.collection('supp_drafts').updateOne(
      { _id: draft._id },
      {
        $set: isCompletingDraft
          ? { status: 'completed', completedAt: pickedAt, pickDeadlineAt: null }
          : { pickDeadlineAt: computePickDeadline(pickedAt, ptm) },
      } as any
    );

    return NextResponse.json({ message: 'Auto-pick made', playerId: chosenPlayerId, pick: currentPick, fromQueue: result.fromQueue ?? false });
  } catch (error) {
    console.error('Auto-pick error:', error);
    return NextResponse.json({ error: 'Auto-pick failed' }, { status: 500 });
  }
}
