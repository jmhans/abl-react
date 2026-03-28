import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { activateRoster, activateRosterXtra, calculateTeamScore } from '@/app/lib/game-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const status = searchParams.get('status') || 'all';
    const includeXtra = searchParams.get('includeXtra') !== 'false';

    const db = await connectToDatabase();

    const games = await db
      .collection('games')
      .find({
        results: { $exists: true, $type: 'array' },
        $expr: { $gte: [{ $size: '$results' }, 2] },
      })
      .limit(limit)
      .toArray();

    let totalGames = 0;
    let matchGames = 0;
    let mismatchGames = 0;
    let totalPlayers = 0;
    let matchPlayers = 0;
    let mismatchPlayers = 0;
    const mismatchDetails: any[] = [];

    const buildStrippedRoster = (players: any[]) =>
      players
        .filter((p: any) => {
          const name = p.player?.name || '';
          return name !== 'supp' && name !== 'four';
        })
        .map((p: any) => ({
          player: p.player,
          lineupPosition: p.lineupPosition,
          lineupOrder: p.lineupOrder,
          dailyStats: p.dailyStats || {},
          playedPosition: null,
          ablstatus: 'bench',
          ablRosterPosition: null,
        }));

    const activePlayers = (lineup: any[], includeExtras: boolean) =>
      lineup.filter((p: any) => p.ablstatus === 'active' && (includeExtras || p.playedPosition !== 'XTRA'));

    const benchWithStats = (lineup: any[]) =>
      lineup.filter((p: any) => p.ablstatus !== 'active' && (p.dailyStats?.g || 0) > 0);

    const nextRosterPos = (lineup: any[]) =>
      lineup
        .filter((p: any) => p.ablstatus === 'active')
        .reduce((max: number, p: any) => Math.max(p.ablRosterPosition ?? 0, max), 0) + 1;

    const computeScores = (homeLineup: any[], awayLineup: any[], includeExtras: boolean) => {
      const hPlayers = activePlayers(homeLineup, includeExtras);
      const aPlayers = activePlayers(awayLineup, includeExtras);

      const homeOppE = aPlayers
        .filter((p: any) => p.playedPosition !== 'DH' && p.playedPosition !== 'XTRA')
        .reduce((sum: number, p: any) => sum + (p.dailyStats?.e || 0), 0);
      const homeOppPB = aPlayers
        .filter((p: any) => p.playedPosition !== 'DH' && p.playedPosition !== 'XTRA')
        .reduce((sum: number, p: any) => sum + (p.dailyStats?.pb || 0), 0);
      const awayOppE = hPlayers
        .filter((p: any) => p.playedPosition !== 'DH' && p.playedPosition !== 'XTRA')
        .reduce((sum: number, p: any) => sum + (p.dailyStats?.e || 0), 0);
      const awayOppPB = hPlayers
        .filter((p: any) => p.playedPosition !== 'DH' && p.playedPosition !== 'XTRA')
        .reduce((sum: number, p: any) => sum + (p.dailyStats?.pb || 0), 0);

      return {
        home: calculateTeamScore(hPlayers, true, homeOppE, homeOppPB),
        away: calculateTeamScore(aPlayers, false, awayOppE, awayOppPB),
      };
    };

    for (const game of games) {
      totalGames++;
      const legacyResult = game.results[game.results.length - 1];
      if (!legacyResult?.scores || legacyResult.scores.length < 2) {
        continue;
      }

      const gameDate = game.gameDate ? new Date(game.gameDate) : null;
      let gameMismatch = false;

      const legacyHome = legacyResult.scores.find((s: any) => s.location === 'H') || legacyResult.scores[0];
      const legacyAway = legacyResult.scores.find((s: any) => s.location === 'A') || legacyResult.scores[1];

      let newHomeLineup = activateRoster(buildStrippedRoster(legacyHome.players || []));
      let newAwayLineup = activateRoster(buildStrippedRoster(legacyAway.players || []));

      if (includeXtra) {
        let finalScores = computeScores(newHomeLineup, newAwayLineup, true);

        while (
          Math.abs(finalScores.home.abl_runs - finalScores.away.abl_runs) <= 0.5 &&
          (benchWithStats(newHomeLineup).length + benchWithStats(newAwayLineup).length > 0)
        ) {
          newHomeLineup = activateRosterXtra(newHomeLineup, nextRosterPos(newHomeLineup));
          newAwayLineup = activateRosterXtra(newAwayLineup, nextRosterPos(newAwayLineup));
          finalScores = computeScores(newHomeLineup, newAwayLineup, true);
        }
      }

      const scoreEntries = [legacyHome, legacyAway];
      const newLineups = [newHomeLineup, newAwayLineup];

      for (let i = 0; i < scoreEntries.length; i++) {
        const scoreEntry = scoreEntries[i];
        const legacyPlayers: any[] = scoreEntry.players || [];
        const teamId = scoreEntry.team?.toString();
        const location = scoreEntry.location || '?';
        const realPlayers = legacyPlayers.filter((p: any) => {
          const name = p.player?.name || '';
          return name !== 'supp' && name !== 'four';
        });

        const newPositionById = new Map<string, string | null>();
        for (const ap of newLineups[i]) {
          const id = ap.player?._id?.toString() || ap._id?.toString();
          if (id && ap.player?.name !== 'supp' && ap.player?.name !== 'four') {
            newPositionById.set(id, ap.playedPosition ?? null);
          }
        }

        for (const lp of realPlayers) {
          const legacyPos = lp.playedPosition ?? null;
          if (!includeXtra && legacyPos === 'XTRA') {
            continue;
          }

          const pid = lp.player?._id?.toString() || lp._id?.toString();
          if (!pid) {
            continue;
          }

          const newPos = newPositionById.get(pid) ?? null;
          totalPlayers++;

          if (newPos === legacyPos) {
            matchPlayers++;
          } else {
            mismatchPlayers++;
            gameMismatch = true;

            if (status !== 'matches' && mismatchDetails.length < 200) {
              mismatchDetails.push({
                gameId: game._id.toString(),
                gameDate: gameDate?.toISOString().substring(0, 10),
                location,
                teamId,
                includeXtra,
                playerName: lp.player?.name,
                lineupPosition: lp.lineupPosition,
                legacyPlayedPosition: legacyPos,
                newPlayedPosition: newPos,
                legacyG: lp.dailyStats?.g ?? null,
                legacyAB: lp.dailyStats?.ab ?? null,
                legacyAPA:
                  (lp.dailyStats?.ab || 0) +
                  (lp.dailyStats?.bb || 0) +
                  (lp.dailyStats?.hbp || 0) +
                  (lp.dailyStats?.sac || 0) +
                  (lp.dailyStats?.sf || 0),
              });
            }
          }
        }
      }

      if (gameMismatch) {
        mismatchGames++;
      } else {
        matchGames++;
      }
    }

    const response: any = {
      includeXtra,
      totalGames,
      matchGames,
      mismatchGames,
      gameMatchPct: totalGames > 0 ? (matchGames / totalGames * 100).toFixed(2) + '%' : 'N/A',
      totalPlayers,
      matchPlayers,
      mismatchPlayers,
      playerMatchPct: totalPlayers > 0 ? (matchPlayers / totalPlayers * 100).toFixed(2) + '%' : 'N/A',
    };

    if (status !== 'matches') {
      response.mismatches = mismatchDetails;
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Activation comparison error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
