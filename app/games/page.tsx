'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGames() {
      try {
        const response = await fetch('/api/games?view=summary');
        if (!response.ok) {
          throw new Error('Failed to fetch games');
        }
        const data = await response.json();
        setGames(data);
      } catch (err) {
        setError('Failed to load games');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchGames();
  }, []);

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

  // Group games by date
  const gamesByDate = games.reduce((acc, game) => {
    const date = new Date(game.gameDate).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(game);
    return acc;
  }, {} as Record<string, Game[]>);

  const dates = Object.keys(gamesByDate).sort((a, b) => 
    new Date(b).getTime() - new Date(a).getTime()
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Link href="/" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to Home
        </Link>
        <h1 className="text-4xl font-bold text-gray-900">ABL Games</h1>
        <p className="text-gray-600 mt-2">{games.length} games total</p>
      </div>

      <div className="space-y-8">
        {dates.map(date => (
          <div key={date} className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">{date}</h2>
            <div className="space-y-4">
              {gamesByDate[date].map(game => {
                const hasResult = !!game.result?.winner;
                const result = hasResult ? game.result! : null;
                const awayScore = formatRuns(extractRuns(findScoreForTeam(result?.scores, game, 'away')?.final));
                const homeScore = formatRuns(extractRuns(findScoreForTeam(result?.scores, game, 'home')?.final));

                return (
                  <Link
                    key={game._id}
                    href={`/games/${game._id}`}
                    className="block border border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:shadow-md transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-4">
                          <div className="text-right min-w-[240px]">
                            <span className={`font-semibold ${result?.winner?._id === game.awayTeam._id ? 'text-green-600' : ''}`}>
                              {game.awayTeam.location} {game.awayTeam.nickname}
                            </span>
                            {awayScore != null && (
                              <span className="ml-3 inline-block min-w-8 text-right font-mono text-gray-900">
                                {awayScore}
                              </span>
                            )}
                          </div>
                          <div className="text-gray-500 font-bold">@</div>
                          <div className="min-w-[240px]">
                            {homeScore != null && (
                              <span className="mr-3 inline-block min-w-8 text-right font-mono text-gray-900">
                                {homeScore}
                              </span>
                            )}
                            <span className={`font-semibold ${result?.winner?._id === game.homeTeam._id ? 'text-green-600' : ''}`}>
                              {game.homeTeam.location} {game.homeTeam.nickname}
                            </span>
                          </div>
                        </div>
                        {game.description && (
                          <p className="text-sm text-gray-600 mt-2">{game.description}</p>
                        )}
                      </div>
                      <div className="text-right ml-4">
                        {hasResult ? (
                          <span className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded text-sm font-medium">
                            Final
                          </span>
                        ) : (
                          <span className="inline-block bg-gray-100 text-gray-600 px-3 py-1 rounded text-sm">
                            Scheduled
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {games.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500 text-lg">No games found</p>
        </div>
      )}
    </div>
  );
}
