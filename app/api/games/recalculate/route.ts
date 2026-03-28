import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { calculateAndStoreLiveGameResult } from '@/app/lib/game-calculation-service';
import { getAdminAuthState } from '@/app/lib/admin-auth';

type LineupPlayer = {
  player?: { _id?: any; mlbID?: any; mlbId?: any; name?: string };
  _id?: any;
  mlbID?: any;
  mlbId?: any;
  name?: string;
  playedPosition?: string | null;
};

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractRuns(scoreLike: any): number | null {
  if (scoreLike == null) return null;
  const direct = toNullableNumber(scoreLike);
  if (direct != null) return direct;
  return toNullableNumber(scoreLike?.abl_runs);
}

function extractScoreBreakdown(scoreLike: any) {
  if (!scoreLike || typeof scoreLike !== 'object') {
    return null;
  }

  return {
    abl_runs: toNullableNumber(scoreLike?.abl_runs),
    abl_points: toNullableNumber(scoreLike?.abl_points),
    ab: toNullableNumber(scoreLike?.ab),
    e: toNullableNumber(scoreLike?.e),
    pb: toNullableNumber(scoreLike?.pb),
    opp_e: toNullableNumber(scoreLike?.opp_e),
    opp_pb: toNullableNumber(scoreLike?.opp_pb),
  };
}

function extractWinnerId(result: any): string | null {
  const winner = result?.winner;
  if (!winner) return null;
  if (typeof winner?.toString === 'function') return winner.toString();
  return String(winner);
}

function normalizePosition(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getPlayerKey(player: LineupPlayer): string | null {
  const nestedId = player?.player?._id;
  const flatId = player?._id;
  const anyId = nestedId ?? flatId;
  if (anyId) return `id:${anyId.toString()}`;

  const nestedMlbId = player?.player?.mlbID ?? player?.player?.mlbId;
  const flatMlbId = player?.mlbID ?? player?.mlbId;
  const anyMlbId = nestedMlbId ?? flatMlbId;
  if (anyMlbId) return `mlb:${anyMlbId.toString()}`;

  const name = player?.player?.name ?? player?.name;
  if (name) return `name:${String(name).trim().toLowerCase()}`;

  return null;
}

function isSyntheticPlayer(player: LineupPlayer): boolean {
  const name = player?.player?.name ?? player?.name;
  if (!name) return false;
  const normalized = String(name).trim().toLowerCase();
  return normalized === 'supp' || normalized === 'four';
}

function toComparablePlayerMap(players: any[] | undefined) {
  const map = new Map<string, { playedPosition: string | null; name: string | null }>();

  for (const raw of Array.isArray(players) ? players : []) {
    const player = raw as LineupPlayer;
    if (isSyntheticPlayer(player)) continue;

    const key = getPlayerKey(player);
    if (!key) continue;

    const name = (player?.player?.name ?? player?.name ?? null) as string | null;
    map.set(key, {
      playedPosition: normalizePosition(player?.playedPosition),
      name,
    });
  }

  return map;
}

function isActivePlayer(raw: any): boolean {
  // New results have ablstatus: 'active'. Old stored results may only have playedPosition set.
  if (raw?.ablstatus === 'active') return true;
  const pos = raw?.playedPosition;
  return typeof pos === 'string' && pos.trim().length > 0;
}

function compareActivePlayers(storedPlayers: any[] | undefined, recalculatedPlayers: any[] | undefined) {
  const storedActive = (Array.isArray(storedPlayers) ? storedPlayers : []).filter(isActivePlayer);
  const recalculatedActive = (Array.isArray(recalculatedPlayers) ? recalculatedPlayers : []).filter(isActivePlayer);
  return compareTeamLineups(storedActive, recalculatedActive);
}

function toActiveLineupSnapshot(players: any[] | undefined) {
  return (Array.isArray(players) ? players : [])
    .filter(isActivePlayer)
    .filter((player) => !isSyntheticPlayer(player))
    .map((player) => ({
      key: getPlayerKey(player),
      name: player?.player?.name ?? player?.name ?? null,
      playedPosition: normalizePosition(player?.playedPosition),
      lineupPosition: normalizePosition(player?.lineupPosition),
      rosterPosition: toNullableNumber(player?.ablRosterPosition),
      lineupOrder: toNullableNumber(player?.lineupOrder),
      abl_points: toNullableNumber(player?.dailyStats?.abl_points),
      ab: toNullableNumber(player?.dailyStats?.ab),
      g: toNullableNumber(player?.dailyStats?.g),
    }))
    .sort((a, b) => {
      const orderA = a.lineupOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.lineupOrder ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '');
    });
}

function filterLineupSnapshotByDiffKeys(
  lineup: ReturnType<typeof toActiveLineupSnapshot>,
  diffKeys: Set<string>,
) {
  if (diffKeys.size === 0) return [];
  return lineup.filter((player) => player.key && diffKeys.has(player.key));
}

function getStatlineChangedKeys(
  storedLineup: ReturnType<typeof toActiveLineupSnapshot>,
  recalculatedLineup: ReturnType<typeof toActiveLineupSnapshot>,
): Set<string> {
  const changed = new Set<string>();
  const storedMap = new Map(storedLineup.filter((p) => !!p.key).map((p) => [p.key as string, p]));
  const recalculatedMap = new Map(recalculatedLineup.filter((p) => !!p.key).map((p) => [p.key as string, p]));

  for (const [key, recalculated] of recalculatedMap.entries()) {
    const stored = storedMap.get(key);
    if (!stored) continue;

    const statsChanged =
      stored.abl_points !== recalculated.abl_points ||
      stored.ab !== recalculated.ab ||
      stored.g !== recalculated.g;

    if (statsChanged) {
      changed.add(key);
    }
  }

  return changed;
}

function compareTeamLineups(storedPlayers: any[] | undefined, recalculatedPlayers: any[] | undefined) {
  const storedMap = toComparablePlayerMap(storedPlayers);
  const recalculatedMap = toComparablePlayerMap(recalculatedPlayers);
  const allKeys = Array.from(new Set([...storedMap.keys(), ...recalculatedMap.keys()]));

  const changed: Array<{
    key: string;
    name: string | null;
    storedPlayedPosition: string | null;
    recalculatedPlayedPosition: string | null;
  }> = [];
  const added: Array<{ key: string; name: string | null; recalculatedPlayedPosition: string | null }> = [];
  const removed: Array<{ key: string; name: string | null; storedPlayedPosition: string | null }> = [];

  for (const key of allKeys) {
    const stored = storedMap.get(key);
    const recalculated = recalculatedMap.get(key);

    if (!stored && recalculated) {
      added.push({
        key,
        name: recalculated.name,
        recalculatedPlayedPosition: recalculated.playedPosition,
      });
      continue;
    }

    if (stored && !recalculated) {
      removed.push({
        key,
        name: stored.name,
        storedPlayedPosition: stored.playedPosition,
      });
      continue;
    }

    if (stored && recalculated && stored.playedPosition !== recalculated.playedPosition) {
      changed.push({
        key,
        name: recalculated.name ?? stored.name,
        storedPlayedPosition: stored.playedPosition,
        recalculatedPlayedPosition: recalculated.playedPosition,
      });
    }
  }

  return {
    storedCount: storedMap.size,
    recalculatedCount: recalculatedMap.size,
    changedCount: changed.length,
    addedCount: added.length,
    removedCount: removed.length,
    changed,
    added,
    removed,
  };
}

function compareGameLineups(game: any, calculatedResult: any) {
  const latestStoredResult = game?.result ?? null;

  if (!latestStoredResult?.scores || !Array.isArray(calculatedResult?.scores)) {
    return {
      available: false,
      reason: 'missing stored or calculated scores',
    };
  }

  const findStoredScore = (calculatedScore: any) => {
    const calcTeam = calculatedScore?.team?.toString?.();
    const calcLocation = calculatedScore?.location;

    return latestStoredResult.scores.find((storedScore: any) => {
      const storedTeam = storedScore?.team?.toString?.();
      if (calcTeam && storedTeam && calcTeam === storedTeam) return true;
      return calcLocation && storedScore?.location && calcLocation === storedScore.location;
    });
  };

  const perTeam: Array<{
    team: string | null;
    location: string | null;
    storedCount: number;
    recalculatedCount: number;
    changedCount: number;
    addedCount: number;
    removedCount: number;
    changed: Array<{
      key: string;
      name: string | null;
      storedPlayedPosition: string | null;
      recalculatedPlayedPosition: string | null;
    }>;
    added: Array<{ key: string; name: string | null; recalculatedPlayedPosition: string | null }>;
    removed: Array<{ key: string; name: string | null; storedPlayedPosition: string | null }>;
  }> = calculatedResult.scores.map((calculatedScore: any) => {
    const storedScore = findStoredScore(calculatedScore);
    const teamComparison = compareTeamLineups(storedScore?.players, calculatedScore?.players);

    return {
      team: calculatedScore?.team?.toString?.() || null,
      location: calculatedScore?.location || null,
      ...teamComparison,
    };
  });

  const totals = perTeam.reduce(
    (acc: { changed: number; added: number; removed: number }, team) => {
      acc.changed += team.changedCount;
      acc.added += team.addedCount;
      acc.removed += team.removedCount;
      return acc;
    },
    { changed: 0, added: 0, removed: 0 },
  );

  return {
    available: true,
    changedCount: totals.changed,
    addedCount: totals.added,
    removedCount: totals.removed,
    hasDiffs: totals.changed + totals.added + totals.removed > 0,
    teams: perTeam,
  };
}

function compareGameScores(game: any, calculatedResult: any) {
  const latestStoredResult = game?.result ?? null;

  if (!latestStoredResult?.scores || !Array.isArray(calculatedResult?.scores)) {
    return {
      available: false,
      reason: 'missing stored or calculated scores',
    };
  }

  const findStoredScore = (calculatedScore: any) => {
    const calcTeam = calculatedScore?.team?.toString?.();
    const calcLocation = calculatedScore?.location;

    return latestStoredResult.scores.find((storedScore: any) => {
      const storedTeam = storedScore?.team?.toString?.();
      if (calcTeam && storedTeam && calcTeam === storedTeam) return true;
      return calcLocation && storedScore?.location && calcLocation === storedScore.location;
    });
  };

  const perTeam = calculatedResult.scores.map((calculatedScore: any) => {
    const storedScore = findStoredScore(calculatedScore);
    const storedRegulationRaw = storedScore?.regulation;
    const storedFinalRaw = storedScore?.final;
    const recalculatedRegulationRaw = calculatedScore?.regulation;
    const recalculatedFinalRaw = calculatedScore?.final;
    const activePlayerDiff = compareActivePlayers(storedScore?.players, calculatedScore?.players);

    const storedRegulation = extractRuns(storedScore?.regulation);
    const storedFinal = extractRuns(storedScore?.final);
    const recalculatedRegulation = extractRuns(calculatedScore?.regulation);
    const recalculatedFinal = extractRuns(calculatedScore?.final);

    const storedActiveLineup = toActiveLineupSnapshot(storedScore?.players);
    const recalculatedActiveLineup = toActiveLineupSnapshot(calculatedScore?.players);

    const lineupDiffKeys = new Set<string>([
      ...activePlayerDiff.changed.map((item) => item.key),
      ...activePlayerDiff.added.map((item) => item.key),
      ...activePlayerDiff.removed.map((item) => item.key),
    ]);

    const statlineChangedKeys = getStatlineChangedKeys(storedActiveLineup, recalculatedActiveLineup);
    for (const key of statlineChangedKeys) {
      lineupDiffKeys.add(key);
    }

    return {
      team: calculatedScore?.team?.toString?.() || null,
      location: calculatedScore?.location || null,
      storedRegulation,
      recalculatedRegulation,
      storedFinal,
      recalculatedFinal,
      storedRegulationDetail: extractScoreBreakdown(storedRegulationRaw),
      recalculatedRegulationDetail: extractScoreBreakdown(recalculatedRegulationRaw),
      storedFinalDetail: extractScoreBreakdown(storedFinalRaw),
      recalculatedFinalDetail: extractScoreBreakdown(recalculatedFinalRaw),
      activePlayerDiff,
      storedActiveLineup: filterLineupSnapshotByDiffKeys(storedActiveLineup, lineupDiffKeys),
      recalculatedActiveLineup: filterLineupSnapshotByDiffKeys(recalculatedActiveLineup, lineupDiffKeys),
      regulationChanged: storedRegulation !== recalculatedRegulation,
      finalChanged: storedFinal !== recalculatedFinal,
    };
  });

  const regulationDiffTeams = perTeam.filter((team: any) => team.regulationChanged).length;
  const finalDiffTeams = perTeam.filter((team: any) => team.finalChanged).length;
  const storedWinner = extractWinnerId(latestStoredResult);
  const recalculatedWinner = extractWinnerId(calculatedResult);

  return {
    available: true,
    hasDiffs: finalDiffTeams > 0 || storedWinner !== recalculatedWinner,
    regulationDiffTeams,
    finalDiffTeams,
    storedWinner,
    recalculatedWinner,
    winnerChanged: storedWinner !== recalculatedWinner,
    teams: perTeam,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const db = await connectToDatabase();
    const body = await request.json().catch(() => ({}));

    // Fetch all teams once for nickname lookup
    const allTeams = await db.collection('ablteams').find({}, { projection: { _id: 1, nickname: 1 } }).toArray();
    const teamNicknameMap = new Map<string, string>(allTeams.map((t: any) => [t._id.toString(), t.nickname || t._id.toString()]));

    const gameId = body.gameId as string | undefined;
    const gameIds = Array.isArray(body.gameIds) ? body.gameIds : undefined;
    const gameDate = body.gameDate as string | undefined;
    const dateStart = body.dateStart as string | undefined;
    const dateEnd = body.dateEnd as string | undefined;
    const compareLineups = body.compareLineups === true;
    const compareScores = body.compareScores === true;
    const save = compareLineups || compareScores ? body.save === true : body.save !== false;
    const limit = Number(body.limit || 1000);

    const query: any = {};

    if (gameId) {
      query._id = new ObjectId(gameId);
    } else if (gameIds?.length) {
      query._id = { $in: gameIds.map((id: string) => new ObjectId(id)) };
    } else if (gameDate) {
      const start = new Date(`${gameDate}T00:00:00.000Z`);
      const end = new Date(`${gameDate}T23:59:59.999Z`);
      query.gameDate = { $gte: start, $lte: end };
    } else if (dateStart || dateEnd) {
      query.gameDate = {};
      if (dateStart) query.gameDate.$gte = new Date(dateStart);
      if (dateEnd) query.gameDate.$lte = new Date(dateEnd);
    }

    const games = await db
      .collection('games')
      .find(query)
      .sort({ gameDate: 1, _id: 1 })
      .limit(limit)
      .allowDiskUse(true)
      .toArray();

    const summary: any[] = [];
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    let lineupCompared = 0;
    let lineupDiffGames = 0;
    let lineupChanged = 0;
    let lineupAdded = 0;
    let lineupRemoved = 0;
    let scoreCompared = 0;
    let scoreDiffGames = 0;
    let regulationDiffTeams = 0;
    let finalDiffTeams = 0;
    let winnerDiffGames = 0;

    for (const game of games) {
      try {
        const outcome = await calculateAndStoreLiveGameResult(db, game, { save });

        if (outcome.status === 'skipped') {
          skipped++;
          summary.push(outcome);
          continue;
        }

        const lineupComparison = compareLineups
          ? compareGameLineups(game, outcome.result)
          : undefined;
        const scoreComparison = compareScores
          ? compareGameScores(game, outcome.result)
          : undefined;

        if (lineupComparison && lineupComparison.available === true) {
          lineupCompared++;
          lineupChanged += lineupComparison.changedCount ?? 0;
          lineupAdded += lineupComparison.addedCount ?? 0;
          lineupRemoved += lineupComparison.removedCount ?? 0;
          if (lineupComparison.hasDiffs) {
            lineupDiffGames++;
          }
        }

        if (scoreComparison && scoreComparison.available === true) {
          scoreCompared++;
          regulationDiffTeams += scoreComparison.regulationDiffTeams ?? 0;
          finalDiffTeams += scoreComparison.finalDiffTeams ?? 0;
          if (scoreComparison.winnerChanged) {
            winnerDiffGames++;
          }
          if (scoreComparison.hasDiffs) {
            scoreDiffGames++;
          }
        }

        processed++;
        const homeTeamId = game.homeTeam?.toString?.();
        const awayTeamId = game.awayTeam?.toString?.();
        summary.push({
          gameId: game._id.toString(),
          status: outcome.status,
          gameDate: game.gameDate,
          homeTeam: homeTeamId,
          awayTeam: awayTeamId,
          homeTeamName: homeTeamId ? (teamNicknameMap.get(homeTeamId) ?? homeTeamId) : undefined,
          awayTeamName: awayTeamId ? (teamNicknameMap.get(awayTeamId) ?? awayTeamId) : undefined,
          homeScore: outcome.result?.scores?.[0]?.final?.abl_runs ?? outcome.result?.scores?.[0]?.final,
          awayScore: outcome.result?.scores?.[1]?.final?.abl_runs ?? outcome.result?.scores?.[1]?.final,
          ...(scoreComparison ? { scoreComparison } : {}),
          ...(lineupComparison ? { lineupComparison } : {}),
        });
      } catch (error) {
        errors++;
        summary.push({
          gameId: game._id.toString(),
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      total: games.length,
      processed,
      skipped,
      errors,
      save,
      compareLineups,
      compareScores,
      scoreSummary: compareScores
        ? {
            gamesCompared: scoreCompared,
            gamesWithDiffs: scoreDiffGames,
            regulationDiffTeams,
            finalDiffTeams,
            winnerDiffGames,
          }
        : undefined,
      lineupSummary: compareLineups
        ? {
            gamesCompared: lineupCompared,
            gamesWithDiffs: lineupDiffGames,
            changedAssignments: lineupChanged,
            addedPlayers: lineupAdded,
            removedPlayers: lineupRemoved,
          }
        : undefined,
      summary,
    });
  } catch (error) {
    console.error('Error recalculating games:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to recalculate games' },
      { status: 500 },
    );
  }
}
