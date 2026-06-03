import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { calculateAblScore } from '@/app/lib/roster-utils';

const SEASON_START = new Date('2026-03-26T00:00:00Z');
const PLAYER_SOURCE_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedPlayerSource: { checkedAt: number; source: 'players_cache' | 'players_view' } | null = null;

function currentSeasonStats(p: any): any {
  const lastUpdate = p.lastStatUpdate ? new Date(p.lastStatUpdate) : null;
  if (!lastUpdate || lastUpdate < SEASON_START) return undefined;
  return p.stats;
}

async function getPlayerSourceCollection(db: any): Promise<'players_cache' | 'players_view'> {
  const now = Date.now();
  if (cachedPlayerSource && now - cachedPlayerSource.checkedAt < PLAYER_SOURCE_CACHE_TTL_MS) {
    return cachedPlayerSource.source;
  }
  const cacheCount = await db.collection('players_cache').estimatedDocumentCount();
  const source: 'players_cache' | 'players_view' = cacheCount > 0 ? 'players_cache' : 'players_view';
  cachedPlayerSource = { checkedAt: now, source };
  return source;
}

/**
 * GET /api/supp-draft/players?league=abl&season=2026&suppDraftId=...
 *
 * Returns the player pool eligible for the supp draft:
 *  - Players NOT on any team's roster as acqType='draft' or 'supp_draft'
 *    (i.e., free agents, and pickup players on rosters)
 *  - PLUS players who are on a roster as acqType='draft' but are drop-indicated
 *    in this supp draft
 *  - MINUS players already picked in the current supp draft
 *
 * Enriched with:
 *  - abl score
 *  - projections (if projSystem param provided)
 *  - onRosterTeamId (team they're on, if any — null = true free agent)
 *  - isDropIndicated
 */
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const leagueSlug = searchParams.get('league') || 'abl';
    const seasonSlug = searchParams.get('season') || 'active';
    const projSystem = searchParams.get('projSystem') || '';
    const search = searchParams.get('search') || '';
    const positionsParam = searchParams.get('positions') || '';
    const showAll = searchParams.get('showAll') === 'true';

    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    // Get the active (or most recent) supp draft to know drop indications + already-picked players
    const suppDraft = await db.collection('supp_drafts').findOne(
      {
        status: { $in: ['pending', 'active'] },
        leagueId: league._id.toString(),
        seasonId: season._id.toString(),
      },
      { sort: { createdAt: -1 } }
    );

    // Build set of already-picked player IDs in supp draft
    const alreadySuppPicked = new Set<string>(
      (suppDraft?.picks || []).map((p: any) => String(p.playerId))
    );

    // Build set of drop-indicated player IDs (with their team)
    type DropIndicationInfo = { teamId: string };
    const dropIndicatedPlayers = new Map<string, DropIndicationInfo>();
    for (const d of suppDraft?.dropIndications || []) {
      dropIndicatedPlayers.set(d.playerId, { teamId: d.teamId });
    }

    // Collect all players currently on rosters as 'draft' or 'supp_draft' (exclude from pool)
    // ...unless they are drop-indicated
    const seasonTeamObjectIds = (season.teamIds || []).map((id: any) =>
      typeof id === 'string' ? new ObjectId(id) : id
    );

    const latestLineups = await db.collection('lineups').aggregate([
      { $match: { ablTeam: { $in: seasonTeamObjectIds } } },
      { $sort: { effectiveDate: -1 } },
      { $group: { _id: '$ablTeam', roster: { $first: '$roster' } } },
    ]).toArray();

    // Players locked to rosters (draft/supp_draft, not drop-indicated)
    const lockedPlayerIds = new Set<string>();
    // Players on a roster (any acqType) — we track this for onRosterTeamId
    type RosterMembership = { teamId: string; acqType: string };
    const playerRosterMap = new Map<string, RosterMembership>();

    for (const lu of latestLineups) {
      const teamId = lu._id.toString();
      for (const r of lu.roster ?? []) {
        const playerId = r.player.toString();
        playerRosterMap.set(playerId, { teamId, acqType: r.acqType ?? 'pickup' });
        if (
          (r.acqType === 'draft' || r.acqType === 'supp_draft') &&
          !dropIndicatedPlayers.has(playerId)
        ) {
          lockedPlayerIds.add(playerId);
        }
      }
    }

    // Fetch player source (cache preferred)
    const sourceCollection = await getPlayerSourceCollection(db);

    const query: Record<string, any> = {
      $and: [
        {
          $or: [
            { 'eligible.0': { $exists: true } },
            { 'stats.batting.atBats': { $gt: 0 } },
          ],
        },
      ],
    };

    if (!showAll) {
      query.$and.push({ status: 'Active' });
    }

    if (search) {
      query.$and.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { mlbID: { $regex: search, $options: 'i' } },
        ],
      });
    }

    if (positionsParam) {
      const selectedPositions = positionsParam.split(',').filter((p) => p.trim());
      if (selectedPositions.length > 0) {
        query.$and.push({ eligible: { $in: selectedPositions } });
      }
    }

    // Fetch projections if requested
    const projFilter: Record<string, any> = { season: 2026 };
    if (projSystem) projFilter.projSystem = projSystem;

    const [players, projRows] = await Promise.all([
      db.collection(sourceCollection).find(query, {
        projection: {
          _id: 1,
          name: 1,
          team: 1,
          position: 1,
          eligible: 1,
          mlbPosition: 1,
          mlbID: 1,
          status: 1,
          stats: 1,
          lastStatUpdate: 1,
        },
      }).toArray(),
      db.collection('projections')
        .find(projFilter, {
          projection: { mlbId: 1, ablProjected: 1, projSystem: 1, stats: 1 },
          sort: { importedAt: -1 },
        })
        .toArray(),
    ]);

    const projMap = new Map<string, any>();
    for (const p of projRows) {
      if (p.mlbId && !projMap.has(p.mlbId)) projMap.set(p.mlbId, p);
    }

    const result = players
      .map((player: any) => {
        const playerId = player._id.toString();

        // Exclude already supp-drafted
        if (alreadySuppPicked.has(playerId)) return null;

        // Exclude locked (draft/supp_draft not drop-indicated)
        if (lockedPlayerIds.has(playerId)) return null;

        const rosterInfo = playerRosterMap.get(playerId) ?? null;
        const isDropIndicated = dropIndicatedPlayers.has(playerId);

        const proj = player.mlbID ? projMap.get(String(player.mlbID)) ?? null : null;
        const stats = currentSeasonStats(player);
        const abl = calculateAblScore(stats);

        return {
          _id: player._id,
          name: player.name,
          team: player.team,
          position: player.position,
          eligible: player.eligible,
          mlbPosition: player.mlbPosition,
          mlbID: player.mlbID,
          status: player.status,
          stats,
          abl,
          ablProjected: proj?.ablProjected ?? null,
          projSystem: proj?.projSystem ?? null,
          projStats: proj?.stats ?? null,
          onRosterTeamId: rosterInfo?.teamId ?? null,
          onRosterAcqType: rosterInfo?.acqType ?? null,
          isDropIndicated,
        };
      })
      .filter(Boolean);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching supp draft players:', error);
    return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 });
  }
}
