import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

const GAMES_CACHE_TTL_MS = 15 * 1000;
const gamesCache = new Map<string, { expiresAt: number; payload: any[] }>();
const gamesInFlight = new Map<string, Promise<any[]>>();

function buildGamesCacheKey(searchParams: URLSearchParams): string {
  return [
    searchParams.get('view') || '',
    searchParams.get('display') || '',
    searchParams.get('league') || '',
    searchParams.get('season') || '',
    searchParams.get('gameType') || '',
    searchParams.get('limit') || '',
  ].join('|');
}

function getCachedGames(cacheKey: string): any[] | null {
  const hit = gamesCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    gamesCache.delete(cacheKey);
    return null;
  }
  return hit.payload;
}

function setCachedGames(cacheKey: string, payload: any[]) {
  const now = Date.now();
  gamesCache.set(cacheKey, { expiresAt: now + GAMES_CACHE_TTL_MS, payload });
  if (gamesCache.size > 64) {
    for (const [key, value] of gamesCache) {
      if (value.expiresAt <= now) gamesCache.delete(key);
    }
  }
}

// GET /api/games - Get all games with populated teams
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cacheKey = buildGamesCacheKey(searchParams);

    const cached = getCachedGames(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-games-cache': 'HIT' } });
    }

    const inFlight = gamesInFlight.get(cacheKey);
    if (inFlight) {
      const payload = await inFlight;
      return NextResponse.json(payload, { headers: { 'x-games-cache': 'WAIT' } });
    }

    const computePromise = (async () => {
      const db = await connectToDatabase();
    const view = searchParams.get('view');
    const display = searchParams.get('display');
    const leagueParam = searchParams.get('league');
    const seasonParam = searchParams.get('season');

    // Build aggregation pipeline
    const pipeline: any[] = [];

    // League+season scoping (optional – falls back to all games if omitted)
    if (leagueParam && seasonParam) {
      try {
        const ctx = await resolveLeagueContext(db, leagueParam, seasonParam);
        pipeline.push({
          $match: {
            leagueId: ctx.league._id,
            seasonId: ctx.season._id,
          },
        });
      } catch {
        // Unknown league/season — return empty
        return [];
      }
    }

    // Optional gameType filter (e.g. 'R' = regular, 'D' = draft, 'P' = playoffs)
    const gameTypeParam = searchParams.get('gameType');
    if (gameTypeParam) {
      pipeline.push({ $match: { gameType: gameTypeParam } });
    }

    // Playoffs filter
    if (display === 'playoffs') {
      pipeline.push({
        $match: { 
          gameDate: { $gte: new Date('2023-08-22T00:00:00Z') } 
        }
      });
    }

    // Summary view - exclude heavy fields
    if (view === 'summary') {
      pipeline.push({
        $project: {
          awayTeamRoster: 0,
          homeTeamRoster: 0,
          'result.scores.players': 0,
        }
      });
    }

    // Optional limit (used for existence checks)
    const limitParam = searchParams.get('limit');
    if (limitParam) pipeline.push({ $limit: parseInt(limitParam, 10) });

    const games = await db.collection('games').aggregate(pipeline, { allowDiskUse: true }).toArray();
    
    // Populate team references
    const teamIds = new Set<string>();
    games.forEach(game => {
      if (game.awayTeam) teamIds.add(game.awayTeam.toString());
      if (game.homeTeam) teamIds.add(game.homeTeam.toString());
      if (game.result?.winner) teamIds.add(game.result.winner.toString());
      if (game.result?.loser) teamIds.add(game.result.loser.toString());
    });

    const teams = await db.collection('ablteams')
      .find({ _id: { $in: Array.from(teamIds).map(id => new ObjectId(id)) } })
      .toArray();
    
    const teamMap = new Map(teams.map(t => [t._id.toString(), t]));

    // Populate teams in response
    games.forEach(game => {
      if (game.awayTeam) game.awayTeam = teamMap.get(game.awayTeam.toString());
      if (game.homeTeam) game.homeTeam = teamMap.get(game.homeTeam.toString());
      if (game.result?.winner) game.result.winner = teamMap.get(game.result.winner.toString());
      if (game.result?.loser) game.result.loser = teamMap.get(game.result.loser.toString());
    });

      setCachedGames(cacheKey, games);
      return games;
    })();

    gamesInFlight.set(cacheKey, computePromise);
    try {
      const payload = await computePromise;
      return NextResponse.json(payload, { headers: { 'x-games-cache': 'MISS' } });
    } finally {
      gamesInFlight.delete(cacheKey);
    }
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}

// POST /api/games - Create new game(s)
export async function POST(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const body = await request.json();
    
    const gamesToCreate = Array.isArray(body) ? body : [body];
    const createdGames = [];

    for (const gameDetails of gamesToCreate) {
      // Check for duplicate
      const existingGame = await db.collection('games').findOne({
        awayTeam: new ObjectId(gameDetails.awayTeam),
        homeTeam: new ObjectId(gameDetails.homeTeam),
        gameDate: new Date(gameDetails.gameDate)
      });

      if (existingGame) {
        throw new Error('Game already exists with those details');
      }

      const game: any = {
        awayTeam: new ObjectId(gameDetails.awayTeam),
        homeTeam: new ObjectId(gameDetails.homeTeam),
        gameDate: new Date(gameDetails.gameDate),
        gameType: gameDetails.gameType || 'R'
      };

      if (gameDetails.description) game.description = gameDetails.description;
      if (gameDetails.seasonId) game.seasonId = new ObjectId(gameDetails.seasonId);
      if (gameDetails.leagueId) game.leagueId = new ObjectId(gameDetails.leagueId);

      const result = await db.collection('games').insertOne(game);
      const createdGame = await db.collection('games').findOne({ _id: result.insertedId });
      createdGames.push(createdGame);
    }

    return NextResponse.json(createdGames[0] || createdGames, { status: 201 });
  } catch (error) {
    console.error('Error creating game:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create game' },
      { status: 500 }
    );
  }
}
