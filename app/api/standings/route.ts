import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

// GET /api/standings?league=abl&season=2025 - Get season-scoped standings
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const leagueSlug = searchParams.get('league');
    const seasonSlug = searchParams.get('season');

    let standings: any[];

    if (leagueSlug && seasonSlug) {
      // Resolve the season to get its ObjectId
      const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);
      const seasonId = ctx.season._id;

      // Dynamically fetch both view pipelines so we stay in sync if views change
      const [standingsDef, advancedDef] = await Promise.all([
        db.listCollections({ name: 'standings_view' }).next() as Promise<any>,
        db.listCollections({ name: 'advanced_standings_view' }).next() as Promise<any>,
      ]);
      const advancedPipeline: any[] = advancedDef?.options?.pipeline ?? [];
      const standingsPipeline: any[] = standingsDef?.options?.pipeline ?? [];

      // Replace the "$lookup from: advanced_standings_view" stage with an inline
      // pipeline lookup on games so the advanced stats are also season-scoped.
      const scopedStandingsPipeline = standingsPipeline.map((stage: any) => {
        if (stage.$lookup?.from === 'advanced_standings_view') {
          return {
            $lookup: {
              as: 'AdvancedStandings',
              from: 'games',
              let: { nickname: '$tm.nickname' },
              pipeline: [
                // Season filter must be first so it runs on game documents
                { $match: { seasonId } },
                ...advancedPipeline,
                // Narrow to the single team being looked up
                { $match: { $expr: { $eq: ['$_id', '$$nickname'] } } },
              ],
            },
          };
        }
        return stage;
      });

      // Prepend the season $match and run directly on the games collection
      standings = await db.collection('games')
        .aggregate([{ $match: { seasonId } }, ...scopedStandingsPipeline])
        .toArray();
    } else {
      // Fallback: no season context — return all data from the unfiltered view
      standings = await db.collection('standings_view').find({}).toArray();
    }

    // Calculate games behind (GB)
    // Find the best record
    const topRecord = standings.reduce((best, team) => {
      const diff = (team.w || 0) - (team.l || 0);
      return Math.max(best, diff);
    }, -Infinity);

    // Add GB and calculated stats to each team
    const enrichedStandings = standings.map(team => {
      const gb = (topRecord - ((team.w || 0) - (team.l || 0))) / 2;
      const wpct = team.g > 0 ? team.w / team.g : 0;
      const batAvg = team.ab > 0 ? team.h / team.ab : 0;
      
      // Calculate streak from outcomes array
      let streak = '';
      if (team.outcomes && Array.isArray(team.outcomes) && team.outcomes.length > 0) {
        const sortedGames = [...team.outcomes].sort((a, b) => 
          new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime()
        );
        const lastOutcome = sortedGames[0]?.outcome?.toUpperCase();
        let count = 0;
        for (const game of sortedGames) {
          if (game.outcome?.toUpperCase() === lastOutcome) {
            count++;
          } else {
            break;
          }
        }
        streak = `${lastOutcome}${count}`;
      }

      // Calculate L10 from outcomes array
      let l10 = '';
      if (team.outcomes && Array.isArray(team.outcomes) && team.outcomes.length > 0) {
        const sortedGames = [...team.outcomes].sort((a, b) => 
          new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime()
        );
        const last10 = sortedGames.slice(0, 10);
        const wins = last10.filter(g => g.outcome?.toLowerCase() === 'w').length;
        const losses = last10.filter(g => g.outcome?.toLowerCase() === 'l').length;
        l10 = `${wins}-${losses}`;
      }

      // Calculate split records
      let homeRecord = '';
      let awayRecord = '';
      let xtrasRecord = '';
      if (team.outcomes && Array.isArray(team.outcomes)) {
        const homeGames = team.outcomes.filter(g => g.location === 'H');
        const awayGames = team.outcomes.filter(g => g.location === 'A');
        const extrasGames = team.outcomes.filter(g => g.extras === true);
        
        const homeW = homeGames.filter(g => g.outcome?.toLowerCase() === 'w').length;
        const homeL = homeGames.filter(g => g.outcome?.toLowerCase() === 'l').length;
        homeRecord = `${homeW}-${homeL}`;
        
        const awayW = awayGames.filter(g => g.outcome?.toLowerCase() === 'w').length;
        const awayL = awayGames.filter(g => g.outcome?.toLowerCase() === 'l').length;
        awayRecord = `${awayW}-${awayL}`;
        
        const xtrasW = extrasGames.filter(g => g.outcome?.toLowerCase() === 'w').length;
        const xtrasL = extrasGames.filter(g => g.outcome?.toLowerCase() === 'l').length;
        xtrasRecord = `${xtrasW}-${xtrasL}`;
      }

      // Get DougLuck stats from AdvancedStandings
      const dougluckw = team.AdvancedStandings?.avgW || 0;
      const dougluckl = team.AdvancedStandings?.avgL || 0;
      const dougluckExcessW = (team.w || 0) - dougluckw;
      
      return {
        _id: team._id,
        tm: team.tm,
        g: team.g,
        w: team.w,
        l: team.l,
        ab: team.ab,
        h: team.h,
        hr: team.hr,
        e: team.e,
        abl_runs: team.abl_runs,
        gb: gb.toFixed(1),
        wpct: wpct.toFixed(3),
        batAvg: batAvg.toFixed(3),
        streak,
        l10,
        homeRecord,
        awayRecord,
        xtrasRecord,
        dougluckw,
        dougluckl,
        dougluckExcessW
      };
    });

    // Sort by wins descending, then by win percentage
    enrichedStandings.sort((a, b) => {
      if (b.w !== a.w) return b.w - a.w;
      return parseFloat(b.wpct) - parseFloat(a.wpct);
    });

    return NextResponse.json(enrichedStandings);
  } catch (error) {
    console.error('Error fetching standings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch standings', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
