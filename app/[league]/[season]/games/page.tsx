'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
    isFinal?: boolean;
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
  const [loggedIn, setLoggedIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGames = useCallback(async () => {
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
    }
  }, [ctx, league, season]);

  useEffect(() => {
    async function load() {
      try {
        const [, cooldownRes] = await Promise.all([
          fetchGames(),
          fetch('/api/scores/refresh').catch(() => null),
        ]);
        const cooldownData = cooldownRes?.ok ? await cooldownRes.json() : null;
        if (cooldownData) {
          setLoggedIn(!!cooldownData.loggedIn);
          if (cooldownData.onCooldown && cooldownData.secondsRemaining > 0) {
            startCooldownTimer(cooldownData.secondsRemaining);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();

    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    };
  }, [league, season]);

  function startCooldownTimer(seconds: number) {
    setCooldownSeconds(seconds);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldownSeconds(prev => {
        if (prev <= 1) {
          clearInterval(cooldownTimer.current!);
          cooldownTimer.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const handleRefresh = async () => {
    if (refreshing || cooldownSeconds > 0) return;
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch('/api/scores/refresh', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429 && data.secondsRemaining) {
          startCooldownTimer(data.secondsRemaining);
          setRefreshMsg({ text: 'Already refreshed recently — try again in a moment.', ok: false });
        } else {
          setRefreshMsg({ text: data.error || 'Refresh failed', ok: false });
        }
      } else {
        setRefreshMsg({ text: `Scores updated — ${data.gamesRecalculated} game${data.gamesRecalculated !== 1 ? 's' : ''} recalculated.`, ok: true });
        startCooldownTimer(300);
        await fetchGames();
      }
    } catch {
      setRefreshMsg({ text: 'Something went wrong.', ok: false });
    } finally {
      setRefreshing(false);
    }
  };

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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">ABL Games</h1>
            <p className="text-gray-500 text-xs mt-0.5">{games.length} games total</p>
          </div>
          {loggedIn && (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <button
                onClick={handleRefresh}
                disabled={refreshing || cooldownSeconds > 0}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {refreshing ? (
                  <>
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Refreshing…
                  </>
                ) : cooldownSeconds > 0 ? (
                  `Refresh (${Math.floor(cooldownSeconds / 60)}:${String(cooldownSeconds % 60).padStart(2, '0')})`
                ) : (
                  '↻ Refresh Scores'
                )}
              </button>
              {refreshMsg && (
                <p className={`text-xs ${refreshMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{refreshMsg.text}</p>
              )}
            </div>
          )}
        </div>
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
                  const isFinal = game.result?.isFinal !== false; // treat missing as true for old records
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
                        <span className={`font-medium truncate ${hasResult && isFinal && result?.winner?._id === game.awayTeam?._id ? 'text-green-700' : 'text-gray-800'} ${isMyGame && game.awayTeam?._id === userTeamId ? 'text-blue-700' : ''}`}>
                          {game.awayTeam?.nickname}
                        </span>
                        <span className="font-mono text-gray-700 shrink-0">{awayScore ?? '—'}</span>
                      </div>
                      {/* Home team */}
                      <div className="flex items-center justify-between gap-1">
                        <span className={`font-medium truncate ${hasResult && isFinal && result?.winner?._id === game.homeTeam?._id ? 'text-green-700' : 'text-gray-800'} ${isMyGame && game.homeTeam?._id === userTeamId ? 'text-blue-700' : ''}`}>
                          {game.homeTeam?.nickname}
                        </span>
                        <span className="font-mono text-gray-700 shrink-0">{homeScore ?? '—'}</span>
                      </div>
                      {/* Status */}
                      <div className="mt-1.5">
                        {hasResult && isFinal ? (
                          <span className="text-green-700 font-medium">Final</span>
                        ) : hasResult ? (
                          <span className="text-yellow-600 font-medium">In Progress</span>
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

