import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getCachedStandings, refreshStandingsCache } from '@/app/lib/standings-service';

// GET /api/standings?league=abl&season=2025 - Get season-scoped standings.
// Reads from standings_cache (kept warm by refreshStandingsCacheForGame after each game
// result is calculated, and by the recompute-standings-cache cron as a safety net).
// Falls back to computing + populating the cache on first request for a season.
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const leagueSlug = searchParams.get('league');
    const seasonSlug = searchParams.get('season');

    if (!leagueSlug || !seasonSlug) {
      return NextResponse.json(
        { error: 'league and season query params are required' },
        { status: 400 }
      );
    }

    const cached = await getCachedStandings(db, leagueSlug, seasonSlug);
    if (cached) {
      return NextResponse.json(cached.standings, {
        headers: { 'X-Standings-Cached-At': cached.calculatedAt.toISOString() },
      });
    }

    // No cache entry yet for this season — compute once and populate it so subsequent
    // requests hit the cache instead of recomputing from raw game data.
    const { standings } = await refreshStandingsCache(db, leagueSlug, seasonSlug);
    return NextResponse.json(standings);
  } catch (error) {
    console.error('Error fetching standings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch standings', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
