import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// ABL lineup positions
const ABL_STARTERS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'DH'];
const VALID_POSITIONS = ['1B', '2B', '3B', 'SS', 'OF', 'C', 'DH'];

interface PlayerStats {
  g?: number;
  ab?: number;
  h?: number;
  '2b'?: number;
  '3b'?: number;
  hr?: number;
  bb?: number;
  ibb?: number;
  hbp?: number;
  sac?: number;
  sf?: number;
  sb?: number;
  cs?: number;
  e?: number;
  pb?: number;
  po?: number;
  abl_points?: number;
}

interface LineupPlayer {
  player: any;
  lineupPosition?: string;
  rosterOrder?: number;
  ablstatus?: string;
  playedPosition?: string;
  lineupOrder?: number;
  rosterPos?: number;
  dailyStats?: PlayerStats;
}

// Helper functions for lineup management
class LineupArray extends Array<LineupPlayer> {
  active() {
    return this.filter(p => p.ablstatus === 'active');
  }

  regulation() {
    return this.active().filter(p => p.playedPosition !== 'XTRA');
  }

  extras() {
    return this.active().filter(p => p.playedPosition === 'XTRA');
  }

  bench() {
    return this.filter(p => p.ablstatus !== 'active');
  }

  benchWithStats() {
    return this.bench().filter(p => p.dailyStats && p.dailyStats.g! > 0);
  }

  order() {
    this.sort((a, b) => (a.lineupOrder || Infinity) - (b.lineupOrder || Infinity));
  }

  scoreReducer(roster: LineupPlayer[], homeTeam: boolean, oppErrors: number, oppPassedBalls: number) {
    return roster.reduce((total: any, curPlyr) => {
      const stats = curPlyr.dailyStats || {};
      total.abl_points += (stats.abl_points || 0);

      if (!['DH', 'XTRA'].includes(curPlyr.playedPosition || '')) {
        total.e += (stats.e || 0);
        total.pb += (stats.pb || 0);
      }

      ['g', 'ab', 'h', '2b', '3b', 'hr', 'bb', 'hbp', 'sac', 'sf', 'sb', 'cs', 'po'].forEach(prop => {
        total[prop] += (stats[prop as keyof PlayerStats] || 0);
      });

      total.abl_runs = total.abl_points / total.ab + 0.5 * oppErrors + 0.2 * oppPassedBalls - 4.5 + 0.5 * (homeTeam ? 1 : 0);

      return total;
    }, {
      abl_runs: 0, abl_points: 0, e: 0, ab: 0, g: 0, h: 0,
      '2b': 0, '3b': 0, hr: 0, bb: 0, hbp: 0, sac: 0, sf: 0,
      sb: 0, cs: 0, po: 0, pb: 0, opp_e: oppErrors, opp_pb: oppPassedBalls
    });
  }

  regulationScore(homeTeam = false, oppErrors = 0, oppPassedBalls = 0) {
    return this.scoreReducer(this.regulation(), homeTeam, oppErrors, oppPassedBalls);
  }

  finalScore(homeTeam = false, oppErrors = 0, oppPassedBalls = 0) {
    return this.scoreReducer(this.active(), homeTeam, oppErrors, oppPassedBalls);
  }

  nextRosterPos() {
    return this.active().reduce((tot, cur) => Math.max(cur.rosterPos || 0, tot), 0) + 1;
  }

  startNextPlayer(position: string, lineupOrder: number, firstOnly: boolean) {
    const bench = this.bench();
    
    for (const player of bench) {
      const canPlay = position === 'DH' || position === 'XTRA' 
        ? VALID_POSITIONS.includes(player.player?.position || '')
        : player.player?.position === position;

      if (canPlay && player.dailyStats && player.dailyStats.g! > 0) {
        player.ablstatus = 'active';
        player.playedPosition = position;
        player.lineupOrder = lineupOrder;
        if (firstOnly) break;
      }
    }
  }
}

// GET /api/games/:id/rosters - Get game rosters with calculated scores
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();

    // Get game with populated teams
    const game = await db.collection('games').findOne({ _id: new ObjectId(id) });
    
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Populate teams
    const teams = await db.collection('ablteams')
      .find({ _id: { $in: [game.homeTeam, game.awayTeam] } })
      .toArray();
    
    const teamMap = new Map(teams.map(t => [t._id.toString(), t]));
    game.homeTeam = teamMap.get(game.homeTeam.toString());
    game.awayTeam = teamMap.get(game.awayTeam.toString());

    const gameDate = new Date(game.gameDate);

    // Get rosters for both teams
    const homeRoster = await getRosterForTeamAndDate(db, game.homeTeam._id, gameDate);
    const awayRoster = await getRosterForTeamAndDate(db, game.awayTeam._id, gameDate);

    let result: any = {
      homeTeam: homeRoster,
      awayTeam: awayRoster,
      home_score: { regulation: {}, final: {} },
      away_score: { regulation: {}, final: {} },
      result: {},
      status: 'scheduled'
    };

    // If game date is in the past, calculate scores
    if (gameDate <= new Date()) {
      result.status = 'live';

      // Get stats for all players
      const homeWithStats = await getStatsForLineup(db, homeRoster, gameDate);
      const awayWithStats = await getStatsForLineup(db, awayRoster, gameDate);

      // Set starting lineups
      const homeLineup = setStarters(new LineupArray(...homeWithStats));
      const awayLineup = setStarters(new LineupArray(...awayWithStats));

      // Calculate scores
      let homeErrors = { reg: homeLineup.regulationScore(true).e, final: homeLineup.finalScore(true).e };
      let awayErrors = { reg: awayLineup.regulationScore(false).e, final: awayLineup.finalScore(false).e };
      let homePBs = { reg: homeLineup.regulationScore(true).pb, final: homeLineup.finalScore(true).pb };
      let awayPBs = { reg: awayLineup.regulationScore(false).pb, final: awayLineup.finalScore(false).pb };

      let homeScore = {
        regulation: homeLineup.regulationScore(true, awayErrors.reg, awayPBs.reg),
        final: homeLineup.finalScore(true, awayErrors.final, awayPBs.final)
      };
      let awayScore = {
        regulation: awayLineup.regulationScore(false, homeErrors.reg, homePBs.reg),
        final: awayLineup.finalScore(false, homeErrors.final, homePBs.final)
      };

      // Handle extra innings (tied game)
      while (
        Math.abs(homeScore.final.abl_runs - awayScore.final.abl_runs) <= 0.5 &&
        (homeLineup.benchWithStats().length + awayLineup.benchWithStats().length > 0)
      ) {
        homeLineup.startNextPlayer('XTRA', homeLineup.nextRosterPos(), false);
        awayLineup.startNextPlayer('XTRA', awayLineup.nextRosterPos(), false);

        homeErrors = { reg: homeLineup.regulationScore(true).e, final: homeLineup.finalScore(true).e };
        awayErrors = { reg: awayLineup.regulationScore(false).e, final: awayLineup.finalScore(false).e };
        homePBs = { reg: homeLineup.regulationScore(true).pb, final: homeLineup.finalScore(true).pb };
        awayPBs = { reg: awayLineup.regulationScore(false).pb, final: awayLineup.finalScore(false).pb };

        homeScore = {
          regulation: homeLineup.regulationScore(true, awayErrors.reg, awayPBs.reg),
          final: homeLineup.finalScore(true, awayErrors.final, awayPBs.final)
        };
        awayScore = {
          regulation: awayLineup.regulationScore(false, homeErrors.reg, homePBs.reg),
          final: awayLineup.finalScore(false, homeErrors.final, homePBs.final)
        };
      }

      homeLineup.order();
      awayLineup.order();

      result = {
        homeTeam: Array.from(homeLineup),
        awayTeam: Array.from(awayLineup),
        home_score: homeScore,
        away_score: awayScore,
        result: {
          winner: homeScore.final.abl_runs > awayScore.final.abl_runs ? game.homeTeam : game.awayTeam,
          loser: homeScore.final.abl_runs > awayScore.final.abl_runs ? game.awayTeam : game.homeTeam
        },
        status: 'live'
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching game rosters:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game rosters', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// Helper: Get roster for team on specific date
async function getRosterForTeamAndDate(db: any, teamId: ObjectId, date: Date) {
  const lineup = await db.collection('lineups').findOne({
    ablTeam: teamId,
    gameDate: date
  });

  if (!lineup || !lineup.roster) {
    return [];
  }

  // Populate players
  const playerIds = lineup.roster.map((p: any) => p.player);
  const players = await db.collection('players')
    .find({ _id: { $in: playerIds } })
    .toArray();
  
  const playerMap = new Map(players.map((p: any) => [p._id.toString(), p]));

  return lineup.roster.map((p: any) => ({
    ...p,
    player: playerMap.get(p.player.toString())
  }));
}

// Helper: Get stats for lineup players
async function getStatsForLineup(db: any, lineup: any[], gameDate: Date) {
  const nextDay = new Date(gameDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const dailyStats = await db.collection('statlines').aggregate([
    {
      $match: {
        gameDate: {
          $gte: new Date(gameDate.toISOString().substring(0, 10) + 'T08:00:00Z'),
          $lt: new Date(nextDay.toISOString().substring(0, 10) + 'T08:00:00Z')
        }
      }
    },
    {
      $lookup: {
        from: 'players',
        localField: 'mlbId',
        foreignField: 'mlbID',
        as: 'player'
      }
    },
    {
      $addFields: {
        player: { $first: '$player' },
        stats: { $ifNull: ['$updatedStats', '$stats'] }
      }
    }
  ]).toArray();

  return lineup.map(plyr => {
    const playerStats = dailyStats
      .filter((statline: any) => statline.mlbId === plyr.player?.mlbID)
      .map((s: any) => s.stats || {})
      .reduce((total: any, stat: any) => {
        Object.keys(stat).forEach(key => {
          if (typeof stat[key] === 'number') {
            total[key] = (total[key] || 0) + stat[key];
          }
        });
        return total;
      }, {});

    return {
      ...plyr,
      dailyStats: playerStats
    };
  });
}

// Helper: Set starting lineup
function setStarters(lineup: LineupArray): LineupArray {
  // First pass: position players only
  for (let i = 0; i < ABL_STARTERS.length; i++) {
    if (ABL_STARTERS[i] !== 'DH') {
      lineup.startNextPlayer(ABL_STARTERS[i], i, true);
    }
  }

  // Second pass: fill remaining spots including DH
  for (let i = 0; i < ABL_STARTERS.length; i++) {
    lineup.startNextPlayer(ABL_STARTERS[i], i, false);
  }

  return lineup;
}
