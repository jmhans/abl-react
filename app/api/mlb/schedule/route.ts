import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/mlb/schedule?date=YYYY-MM-DD
 *
 * Returns a live snapshot of MLB game statuses for the given date.
 * Used by the game detail page to show inning + score next to each player.
 *
 * Response shape:
 *   { games: MlbGameStatus[] }
 *
 * Each MlbGameStatus:
 *   { awayTeam, homeTeam, state, inning, inningState, awayRuns, homeRuns }
 */

export interface MlbGameStatus {
  awayTeam: string;
  homeTeam: string;
  state: 'Preview' | 'Live' | 'Final';
  inning: number | null;
  inningState: string | null; // "Top", "Bottom", "Middle", "End"
  awayRuns: number | null;
  homeRuns: number | null;
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&gameType=R&hydrate=linescore,team`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) {
      return NextResponse.json({ error: 'MLB API unavailable' }, { status: 502 });
    }
    const data = await resp.json();

    const games: MlbGameStatus[] = [];
    for (const dateEntry of (data.dates ?? []) as any[]) {
      for (const game of (dateEntry.games ?? []) as any[]) {
        const state: string = game.status?.abstractGameState ?? 'Preview';
        const linescore = game.linescore;
        games.push({
          awayTeam: game.teams?.away?.team?.abbreviation ?? '',
          homeTeam: game.teams?.home?.team?.abbreviation ?? '',
          state: (state === 'Live' || state === 'Final') ? state : 'Preview',
          inning: linescore?.currentInning ?? null,
          inningState: linescore?.inningState ?? null,
          awayRuns: linescore?.teams?.away?.runs ?? null,
          homeRuns: linescore?.teams?.home?.runs ?? null,
        });
      }
    }

    return NextResponse.json({ games });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch MLB schedule' }, { status: 500 });
  }
}
