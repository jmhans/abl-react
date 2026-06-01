import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { getNextRosterGameDate } from '@/app/lib/roster-utils';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { getDraftEligiblePositions, DraftPlayer } from '@/app/lib/draft-utils';

function toObjectId(id: string) {
  return new ObjectId(id);
}

/**
 * POST /api/supp-draft/finalize
 * Body: { league, season }
 *
 * Finalizes the supp draft:
 *  1. For every team in the season, load their current roster snapshot
 *  2. Remove all players with acqType === 'pickup'
 *  3. Remove all players indicated for drop (dropIndications)
 *  4. Append supp draft picks with acqType = 'supp_draft'
 *  5. Write a new lineup snapshot at the next roster game date
 *  6. Mark supp draft as completed
 */
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

    const draft = await db.collection('supp_drafts').findOne(
      { status: { $in: ['active', 'completed'] }, leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No active supp draft found' }, { status: 404 });
    }

    const picks: any[] = draft.picks || [];
    if (picks.length === 0) {
      return NextResponse.json({ error: 'Supp draft has no picks' }, { status: 400 });
    }

    const effectiveDate = await getNextRosterGameDate(db);

    // Build a set of drop-indicated player IDs per team
    type TeamDropSet = Set<string>;
    const dropsByTeam = new Map<string, TeamDropSet>();
    for (const d of draft.dropIndications || []) {
      if (!dropsByTeam.has(d.teamId)) dropsByTeam.set(d.teamId, new Set());
      dropsByTeam.get(d.teamId)!.add(d.playerId);
    }

    // Group supp draft picks by team
    const suppPicksByTeam = new Map<string, any[]>();
    for (const entry of picks) {
      const teamId = String(entry.pick?.teamId || '');
      if (!teamId) continue;
      if (!suppPicksByTeam.has(teamId)) suppPicksByTeam.set(teamId, []);
      suppPicksByTeam.get(teamId)!.push(entry);
    }

    // Fetch player data for all supp picks (for lineupPosition assignment)
    const allSuppPlayerIds = picks
      .map((entry: any) => entry.playerId)
      .filter(Boolean)
      .map((id: string) => new ObjectId(id));
    const suppPlayers = allSuppPlayerIds.length
      ? await db.collection('players_view').find({ _id: { $in: allSuppPlayerIds } }).toArray()
      : [];
    const suppPlayerMap = new Map(suppPlayers.map((p: any) => [p._id.toString(), p]));

    // Get all season teams and their most-recent lineups
    const seasonTeamObjectIds = (season.teamIds || []).map((id: any) =>
      typeof id === 'string' ? new ObjectId(id) : id
    );

    // Aggregate: for each team, get its most recent lineup
    const latestLineups = await db.collection('lineups').aggregate([
      { $match: { ablTeam: { $in: seasonTeamObjectIds } } },
      { $sort: { effectiveDate: -1 } },
      { $group: { _id: '$ablTeam', doc: { $first: '$$ROOT' } } },
    ]).toArray();

    const latestLineupByTeam = new Map<string, any>();
    for (const row of latestLineups) {
      latestLineupByTeam.set(row._id.toString(), row.doc);
    }

    const lineupOps: any[] = [];

    for (const teamObjId of seasonTeamObjectIds) {
      const teamId = teamObjId.toString();
      const currentLineup = latestLineupByTeam.get(teamId);

      // Start from existing roster (carry over draft picks and any other non-pickup entries)
      const existingRoster: any[] = (currentLineup?.roster || []);

      // 1. Remove pickups
      // 2. Remove drop-indicated players
      const dropSet = dropsByTeam.get(teamId) ?? new Set<string>();
      const retainedRoster = existingRoster.filter((r: any) => {
        if (r.acqType === 'fa' || r.acqType === 'trade') return false;
        if (dropSet.has(r.player.toString())) return false;
        return true;
      });

      // 3. Append supp draft picks
      const teamSuppPicks = (suppPicksByTeam.get(teamId) || [])
        .sort((a: any, b: any) => a.pick.overallPick - b.pick.overallPick);

      const suppRosterEntries = teamSuppPicks.map((entry: any) => {
        const player = suppPlayerMap.get(entry.playerId);
        const eligiblePositions = player
          ? getDraftEligiblePositions(player as unknown as DraftPlayer)
          : [];
        return {
          player: toObjectId(entry.playerId),
          lineupPosition: eligiblePositions.length > 0 ? eligiblePositions[0] : null,
          acqType: 'supp_draft',
        };
      });

      // Combine retained + supp picks, deduplicate by player ID, re-index rosterOrder
      const seenPlayerIds = new Set(retainedRoster.map((r: any) => r.player.toString()));
      const dedupedSuppEntries = suppRosterEntries.filter((r: any) => {
        const pid = r.player.toString();
        if (seenPlayerIds.has(pid)) return false;
        seenPlayerIds.add(pid);
        return true;
      });
      const newRoster = [...retainedRoster, ...dedupedSuppEntries].map((r, idx) => ({
        ...r,
        rosterOrder: idx + 1,
      }));

      lineupOps.push({
        updateOne: {
          filter: { ablTeam: toObjectId(teamId), effectiveDate },
          update: {
            $set: { roster: newRoster, updatedAt: new Date() },
            $setOnInsert: { ablTeam: toObjectId(teamId), effectiveDate },
          },
          upsert: true,
        },
      });
    }

    if (lineupOps.length > 0) {
      await db.collection('lineups').bulkWrite(lineupOps);
    }

    await db.collection('supp_drafts').updateOne(
      { _id: draft._id },
      { $set: { status: 'finalized', completedAt: new Date(), effectiveDate } }
    );

    return NextResponse.json({
      success: true,
      lineupsUpdated: lineupOps.length,
      effectiveDate,
    });
  } catch (error) {
    console.error('Error finalizing supp draft:', error);
    return NextResponse.json({ error: 'Failed to finalize supp draft' }, { status: 500 });
  }
}
