'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLeagueSeason, leagueSeasonQuery } from '@/app/lib/league-season-context';

interface Team {
  _id: string;
  nickname: string;
  location?: string;
}

interface Game {
  _id: string;
  gameDate: string;
  awayTeam: Team;
  homeTeam: Team;
  gameType?: string;
  description?: string;
  result?: {
    winner?: Team;
    loser?: Team;
    scores?: any[];
  };
}

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

function formatRuns(value: number | null): string | null {
  if (value == null) return null;
  return value.toFixed(2);
}

function findScoreForTeam(scores: any[] | undefined, game: Game, side: 'away' | 'home') {
  const teamId = side === 'away' ? game.awayTeam?._id : game.homeTeam?._id;
  const location = side === 'away' ? 'A' : 'H';
  return (Array.isArray(scores) ? scores : []).find((score: any) => {
    const scoreTeamId = score?.team?._id || score?.team?.toString?.() || score?.team;
    if (teamId && scoreTeamId && String(scoreTeamId) === String(teamId)) return true;
    return score?.location === location;
  });
}

export default function GamesPage() {
  const ctx = useLeagueSeason();
  const { league, season } = ctx;

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [gamesRes, myLeaguesRes] = await Promise.all([
          fetch(`/api/games?view=summary&${leagueSeasonQuery(ctx)}`),
          fetch('/api/auth/my-leagues').catch(() => null),
        ]);
        if (!gamesRes.ok) throw new Error('Failed to fetch games');
        setGames(await gamesRes.json());

        const myLeaguesData = myLeaguesRes?.ok ? await myLeaguesRes.json() : [];
        const myEntry = (Array.isArray(myLeaguesData) ? myLeaguesData : []).find(
          (e: any) => e.league?.slug === league && String(e.season?.year) === String(season)
        );
        if (myEntry?.team?._id) setUserTeamId(myEntry.team._id);
      } catch (err) {
        setError('Failed to load games');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [league, season]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading games...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-600">{error}</div>
      </div>
    );
  }

  // Group by date, sort dates ascending (earliest first)
  const gamesByDate = games.reduce((acc, game) => {
    const date = new Date(game.gameDate).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(game);
    return acc;
  }, {} as Record<string, Game[]>);

  const dates = Object.keys(gamesByDate).sort((a, b) =>
    new Date(a).getTime() - new Date(b).getTime()
  );

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-4 py-6 md:py-8">
      <div className="mb-4 md:mb-6">
        <Link href={`/${league}/${season}`} className="text-blue-600 hover:text-blue-800 mb-2 inline-block text-sm">
          ← Back to Home
        </Link>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">ABL Games</h1>
        <p className="text-gray-500 text-xs mt-0.5">{games.length} games total</p>
      </div>

      <div className="space-y-4">
        {dates.map(date => {
          // Sort: user's games first, then others
          const sorted = [...gamesByDate[date]].sort((a, b) => {
            const aIsMyGame = userTeamId && (a.awayTeam?._id === userTeamId || a.homeTeam?._id === userTeamId) ? -1 : 0;
            const bIsMyGame = userTeamId && (b.awayTeam?._id === userTeamId || b.homeTeam?._id === userTeamId) ? -1 : 0;
            return aIsMyGame - bIsMyGame;
          });

          return (
            <div key={date}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 px-1">{date}</h2>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {sorted.map(game => {
                  const isMyGame = !!userTeamId && (game.awayTeam?._id === userTeamId || game.homeTeam?._id === userTeamId);
                  const hasResult = !!game.result?.winner;
                  const result = hasResult ? game.result! : null;
                  const awayScore = formatRuns(extractRuns(findScoreForTeam(result?.scores, game, 'away')?.final));
                  const homeScore = formatRuns(extractRuns(findScoreForTeam(result?.scores, game, 'home')?.final));

                  return (
                    <Link
                      key={game._id}
                      href={`/${league}/${season}/games/${game._id}`}
                      className={`flex-shrink-0 w-44 rounded-lg border p-2.5 hover:shadow-md transition-all text-xs ${
                        isMyGame
                          ? 'border-blue-400 bg-blue-50 hover:border-blue-500'
                          : 'border-gray-200 bg-white hover:border-blue-400'
                      }`}
                    >
                      {/* Away team */}
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className={`font-medium truncate ${result?.winner?._id === game.awayTeam?._id ? 'text-green-700' : 'text-gray-800'} ${isMyGame && game.awayTeam?._id === userTeamId ? 'text-blue-700' : ''}`}>
                          {game.awayTeam?.nickname}
                        </span>
                        <span className="font-mono text-gray-700 shrink-0">{awayScore ?? '—'}</span>
                      </div>
                      {/* Home team */}
                      <div className="flex items-center justify-between gap-1">
                        <span className={`font-medium truncate ${result?.winner?._id === game.homeTeam?._id ? 'text-green-700' : 'text-gray-800'} ${isMyGame && game.homeTeam?._id === userTeamId ? 'text-blue-700' : ''}`}>
                          {game.homeTeam?.nickname}
                        </span>
                        <span className="font-mono text-gray-700 shrink-0">{homeScore ?? '—'}</span>
                      </div>
                      {/* Status */}
                      <div className="mt-1.5">
                        {hasResult ? (
                          <span className="text-green-700 font-medium">Final</span>
                        ) : (
                          <span className="text-gray-400">Scheduled</span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {games.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500 text-sm">No games found</p>
        </div>
      )}
    </div>
  );
}

