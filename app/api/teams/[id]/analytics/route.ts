import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { deriveAblDate } from '@/app/lib/abl-date';
import { resolveLeagueContext, seasonFilter } from '@/app/lib/league-context';

/** ABL lineup slot order — must match game-utils.ts */
const ABL_NON_DH_SLOTS = ['1B', '2B', 'SS', '3B', 'OF', 'OF', 'OF', 'C'] as const;

/** Positions eligible for DH / XTRA slots — must match game-utils.ts */
const VALID_POSITIONS = ['1B', '2B', '3B', 'SS', 'OF', 'C', 'DH'];

/**
 * Simulate Pass 1 of the ABL activation algorithm on a raw lineup roster
 * (assumes all players played) and return the set of player ID strings who
 * are the designated starter for each slot, including DH.
 *
 * Non-DH positional slots: first player in rosterOrder with exact lineupPosition match.
 * DH starter: first unclaimed player in rosterOrder whose lineupPosition is in VALID_POSITIONS.
 */
function getDesignatedStarters(
  roster: Array<{ player: ObjectId; lineupPosition: string | null; rosterOrder: number }>,
): Set<string> {
  const sorted = [...roster].sort((a, b) => a.rosterOrder - b.rosterOrder);
  const claimed = new Set<string>();
  const starters = new Set<string>();

  for (const slot of ABL_NON_DH_SLOTS) {
    for (const r of sorted) {
      const pid = r.player.toString();
      if (!claimed.has(pid) && r.lineupPosition === slot) {
        claimed.add(pid);
        starters.add(pid);
        break;
      }
    }
  }

  // DH starter: first unclaimed eligible player
  for (const r of sorted) {
    const pid = r.player.toString();
    if (!claimed.has(pid) && r.lineupPosition && VALID_POSITIONS.includes(r.lineupPosition)) {
      starters.add(pid);
      break;
    }
  }

  return starters;
}

// GET /api/teams/:id/analytics
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: teamId } = await params;

  let teamObjId: ObjectId;
  try {
    teamObjId = new ObjectId(teamId);
  } catch {
    return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 });
  }

  const { searchParams } = new URL(_request.url);
  const leagueSlug = searchParams.get('league');
  const seasonSlug = searchParams.get('season');

  const db = await connectToDatabase();

  // Resolve league/season context for scoping (required)
  let gameFilter: Record<string, any> = { 'result.scores.team': teamObjId };
  if (leagueSlug && seasonSlug) {
    try {
      const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);
      Object.assign(gameFilter, seasonFilter(ctx));
    } catch {
      return NextResponse.json({ error: 'League or season not found' }, { status: 404 });
    }
  }

  // Fetch team info
  const team = await db.collection('ablteams').findOne(
    { _id: teamObjId },
    { projection: { nickname: 1, location: 1 } },
  );
  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  // Fetch all lineup docs for this team (sorted asc so we can binary-walk later)
  // Lineups are not league/season scoped — the team membership implies the season
  const lineups = await db
    .collection('lineups')
    .find({ ablTeam: teamObjId })
    .sort({ effectiveDate: 1 })
    .project({ effectiveDate: 1, roster: 1 })
    .toArray();

  // Fetch all scored games for this team, scoped to league+season
  const games = await db
    .collection('games')
    .find(gameFilter, { projection: { gameDate: 1, 'result.scores': 1 } })
    .sort({ gameDate: 1 })
    .toArray();

  // --- Per-player accumulation maps ---
  const playerNames = new Map<string, string>();           // id -> name
  const playerLineupPositions = new Map<string, string>(); // id -> most recent lineupPosition
  const designatedStartCounts = new Map<string, number>(); // id -> count
  const appearanceCounts = new Map<string, { starter: number; sub: number; xtra: number }>();

  // Build lineupPosition map from all lineups (later entries overwrite earlier ones)
  for (const lineup of lineups) {
    for (const r of lineup.roster ?? []) {
      const pid = (r.player as ObjectId).toString();
      if (r.lineupPosition) {
        playerLineupPositions.set(pid, r.lineupPosition as string);
      }
    }
  }

  /**
   * Find the most recent lineup whose effectiveDate <= officialDate.
   * Lineups array is sorted ASC, so we walk from the end.
   */
  function getEffectiveLineup(officialDate: string) {
    for (let i = lineups.length - 1; i >= 0; i--) {
      if ((lineups[i].effectiveDate as string) <= officialDate) return lineups[i];
    }
    return null;
  }

  // Process games
  const uniqueContributors = new Set<string>();
  let scoredGameCount = 0;

  for (const game of games) {
    const teamScore = (game.result?.scores as any[])?.find(
      (s) => (s.team as ObjectId).toString() === teamId,
    );
    if (!teamScore) continue;

    scoredGameCount++;
    const officialDate = deriveAblDate(game.gameDate as Date);

    // Metrics 3, 4, 5: appearances by ablPlayedType
    for (const p of (teamScore.players ?? []) as any[]) {
      if (p.ablstatus !== 'active') continue;
      if (!p.player?._id) continue; // skip supp / four supplementals

      const pid = (p.player._id as ObjectId).toString();

      if (p.player.name && !playerNames.has(pid)) {
        playerNames.set(pid, p.player.name as string);
      }

      uniqueContributors.add(pid);

      const existing = appearanceCounts.get(pid) ?? { starter: 0, sub: 0, xtra: 0 };
      const type = p.ablPlayedType as string | undefined;
      if (type === 'STARTER') existing.starter++;
      else if (type === 'SUB') existing.sub++;
      else if (type === 'XTRA') existing.xtra++;
      appearanceCounts.set(pid, existing);
    }

    // Metric 2: designated starts — simulate Pass 1 on the effective lineup for this date
    const effectiveLineup = getEffectiveLineup(officialDate);
    if (effectiveLineup) {
      const starters = getDesignatedStarters(effectiveLineup.roster ?? []);
      for (const pid of starters) {
        designatedStartCounts.set(pid, (designatedStartCounts.get(pid) ?? 0) + 1);
      }
    }
  }

  // Union of all known player IDs across lineups + games
  const allPlayerIds = new Set<string>([
    ...playerNames.keys(),
    ...playerLineupPositions.keys(),
    ...designatedStartCounts.keys(),
    ...appearanceCounts.keys(),
  ]);

  // Fetch names for any players known only from lineups (not in game results)
  const unknownNameIds = [...allPlayerIds].filter((pid) => !playerNames.has(pid));
  if (unknownNameIds.length > 0) {
    const playerDocs = await db
      .collection('players_view')
      .find({ _id: { $in: unknownNameIds.map((id) => new ObjectId(id)) } })
      .project({ name: 1 })
      .toArray();
    for (const doc of playerDocs) {
      playerNames.set(doc._id.toString(), doc.name as string);
    }
  }

  // Build response
  const players = [...allPlayerIds]
    .map((pid) => {
      const app = appearanceCounts.get(pid) ?? { starter: 0, sub: 0, xtra: 0 };
      return {
        _id: pid,
        name: playerNames.get(pid) ?? 'Unknown',
        lineupPosition: playerLineupPositions.get(pid) ?? null,
        designatedStarts: designatedStartCounts.get(pid) ?? 0,
        appearances: {
          starter: app.starter,
          sub: app.sub,
          xtra: app.xtra,
          total: app.starter + app.sub + app.xtra,
        },
      };
    })
    .sort((a, b) => {
      const diff = b.appearances.total - a.appearances.total;
      if (diff !== 0) return diff;
      return b.designatedStarts - a.designatedStarts;
    });

  return NextResponse.json({
    teamId,
    nickname: team.nickname as string,
    location: (team.location as string) ?? null,
    lineupChangeCount: lineups.length,
    uniqueContributorCount: uniqueContributors.size,
    scoredGameCount,
    players,
  });
}
