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
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [showAllPast, setShowAllPast] = useState(false);
  const [showAllFuture, setShowAllFuture] = useState(false);

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
          if (cooldownData.lastRefreshedAt) {
            setLastRefreshedAt(new Date(cooldownData.lastRefreshedAt));
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

  // Keep the "X min ago" display current (only when there's a timestamp to show)
  useEffect(() => {
    if (!lastRefreshedAt || refreshMsg) return;
    const ticker = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(ticker);
  }, [lastRefreshedAt, refreshMsg]);

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
        const { gamesRecalculated, gamesSkipped, mlbGamesActive, mlbGamesComplete, playersUpdated } = data;
        let msg: string;
        if (!mlbGamesActive) {
          msg = `Stats refreshed — MLB games haven't started yet today (${playersUpdated} player${playersUpdated !== 1 ? 's' : ''} updated).`;
        } else if (gamesRecalculated > 0) {
          const finalLabel = mlbGamesComplete ? ' (final)' : ' (in progress)';
          msg = `Scores updated — ${gamesRecalculated} game${gamesRecalculated !== 1 ? 's' : ''} recalculated${finalLabel}.`;
        } else if (gamesSkipped > 0) {
          msg = `Stats refreshed — ${gamesSkipped} game${gamesSkipped !== 1 ? 's' : ''} couldn't be calculated (lineups may be missing).`;
        } else {
          msg = `Stats refreshed — no ABL games found for today (${playersUpdated} player${playersUpdated !== 1 ? 's' : ''} updated).`;
        }
        setRefreshMsg({ text: msg, ok: true });
        startCooldownTimer(300);
        if (data.refreshedAt) setLastRefreshedAt(new Date(data.refreshedAt));
        await fetchGames();
      }
    } catch {
      setRefreshMsg({ text: 'Something went wrong.', ok: false });
    } finally {
      setRefreshing(false);
    }
  };

  function formatLastRefreshed(ts: Date, reference: Date): string {
    const diffMs = reference.getTime() - ts.getTime();
    if (diffMs < 0) return 'just now';
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} hr${diffHours !== 1 ? 's' : ''} ago`;
    return ts.toLocaleDateString();
  }

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

  // Split dates into past (≤ today) and future (> today)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const pastDates = dates.filter(d => new Date(d).getTime() <= todayStart.getTime());
  const futureDates = dates.filter(d => new Date(d).getTime() > todayStart.getTime());

  // Most recent game date = latest past date with at least one game result
  let mostRecentGameDate: string | null = null;
  for (let i = pastDates.length - 1; i >= 0; i--) {
    if (gamesByDate[pastDates[i]].some(g => g.result?.winner != null)) {
      mostRecentGameDate = pastDates[i];
      break;
    }
  }
  if (mostRecentGameDate == null) mostRecentGameDate = pastDates[pastDates.length - 1] ?? null;

  // Default: show last 3 past dates and first 3 future dates
  const visiblePastDates = showAllPast ? pastDates : pastDates.slice(-3);
  const visibleFutureDates = showAllFuture ? futureDates : futureDates.slice(0, 3);
  const hiddenPastCount = pastDates.length - visiblePastDates.length;
  const hiddenFutureCount = futureDates.length - visibleFutureDates.length;
  const visibleDates = [...visiblePastDates, ...visibleFutureDates];

  const expandBtnClass =
    'text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2';

  return (
    <div className="max-w-full mx-auto px-3 md:px-4 py-6 md:py-8">
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
              {lastRefreshedAt && !refreshMsg && (
                <p className="text-xs text-gray-400">Last updated {formatLastRefreshed(lastRefreshedAt, now)}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {hiddenPastCount > 0 && (
          <div className="text-center">
            <button
              onClick={() => setShowAllPast(true)}
              className={expandBtnClass}
            >
              ↑ Show {hiddenPastCount} earlier date{hiddenPastCount !== 1 ? 's' : ''}
            </button>
          </div>
        )}
        {visibleDates.map(date => {
          // Sort: user's games first, then others
          const sorted = [...gamesByDate[date]].sort((a, b) => {
            const aIsMyGame = userTeamId && (a.awayTeam?._id === userTeamId || a.homeTeam?._id === userTeamId) ? -1 : 0;
            const bIsMyGame = userTeamId && (b.awayTeam?._id === userTeamId || b.homeTeam?._id === userTeamId) ? -1 : 0;
            return aIsMyGame - bIsMyGame;
          });

          const isMostRecent = date === mostRecentGameDate;

          return (
            <div
              key={date}
              className={
                isMostRecent
                  ? 'rounded-xl border-2 border-blue-500 dark:border-blue-400 px-3 pt-2 pb-3 bg-blue-50/40 dark:bg-blue-900/20'
                  : ''
              }
            >
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 px-1">
                {date}
                {isMostRecent && (
                  <span className="ml-2 text-blue-600 dark:text-blue-400 normal-case tracking-normal font-medium">
                    Most Recent
                  </span>
                )}
              </h2>
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
        {hiddenFutureCount > 0 && (
          <div className="text-center">
            <button
              onClick={() => setShowAllFuture(true)}
              className={expandBtnClass}
            >
              ↓ Show {hiddenFutureCount} more upcoming date{hiddenFutureCount !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>

      {games.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500 text-sm">No games found</p>
        </div>
      )}
    </div>
  );
}

