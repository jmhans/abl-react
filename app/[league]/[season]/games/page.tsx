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

interface DateSummary {
  date: string; // YYYY-MM-DD (UTC)
  count: number;
  hasFinal: boolean;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dedupeGamesById(games: Game[]): Game[] {
  const map = new Map(games.map((g) => [g._id, g]));
  return Array.from(map.values());
}

function formatDateHeading(iso: string): string {
  // Noon UTC avoids any local-timezone day-shift when converting the date-only string.
  return new Date(iso + 'T12:00:00Z').toLocaleDateString();
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
  const [dateSummaries, setDateSummaries] = useState<DateSummary[]>([]);
  const [loadedRange, setLoadedRange] = useState<{ from: string; to: string } | null>(null);
  const [expandingPast, setExpandingPast] = useState(false);
  const [expandingFuture, setExpandingFuture] = useState(false);

  const fetchGamesForRange = useCallback(async (dateFrom: string, dateTo: string): Promise<Game[]> => {
    const res = await fetch(
      `/api/games?view=summary&${leagueSeasonQuery(ctx)}&dateFrom=${dateFrom}&dateTo=${dateTo}T23:59:59.999Z`
    );
    if (!res.ok) throw new Error('Failed to fetch games');
    return res.json();
  }, [ctx]);

  // Two-phase load: first a cheap per-date summary (small payload, no full game docs)
  // to figure out the default visible window, then fetch full game data only for that
  // window instead of the whole season. "Show more" expands the loaded range on demand.
  const fetchGames = useCallback(async () => {
    try {
      const [datesRes, myLeaguesRes] = await Promise.all([
        fetch(`/api/games?view=dates&${leagueSeasonQuery(ctx)}`),
        fetch('/api/auth/my-leagues').catch(() => null),
      ]);
      if (!datesRes.ok) throw new Error('Failed to fetch games');
      const dates: DateSummary[] = await datesRes.json();
      setDateSummaries(dates);

      const today = todayIso();
      const pastDates = dates.filter((d) => d.date <= today).map((d) => d.date);
      const futureDates = dates.filter((d) => d.date > today).map((d) => d.date);
      const visible = [...pastDates.slice(-3), ...futureDates.slice(0, 3)];

      if (visible.length > 0) {
        const from = visible[0];
        const to = visible[visible.length - 1];
        const gamesData = await fetchGamesForRange(from, to);
        setGames(gamesData);
        setLoadedRange({ from, to });
      } else {
        setGames([]);
        setLoadedRange(null);
      }

      const myLeaguesData = myLeaguesRes?.ok ? await myLeaguesRes.json() : [];
      const myEntry = (Array.isArray(myLeaguesData) ? myLeaguesData : []).find(
        (e: any) => e.league?.slug === league && String(e.season?.year) === String(season)
      );
      if (myEntry?.team?._id) setUserTeamId(myEntry.team._id);
    } catch (err) {
      setError('Failed to load games');
      console.error(err);
    }
  }, [ctx, league, season, fetchGamesForRange]);

  const expandPast = useCallback(async () => {
    if (!loadedRange || expandingPast) return;
    const earliestDate = dateSummaries[0]?.date;
    if (!earliestDate || earliestDate >= loadedRange.from) {
      setShowAllPast(true);
      return;
    }
    setExpandingPast(true);
    try {
      const extra = await fetchGamesForRange(earliestDate, addDaysIso(loadedRange.from, -1));
      setGames((prev) => dedupeGamesById([...extra, ...prev]));
      setLoadedRange((r) => (r ? { from: earliestDate, to: r.to } : r));
      setShowAllPast(true);
    } catch (err) {
      console.error(err);
    } finally {
      setExpandingPast(false);
    }
  }, [loadedRange, expandingPast, dateSummaries, fetchGamesForRange]);

  const expandFuture = useCallback(async () => {
    if (!loadedRange || expandingFuture) return;
    const latestDate = dateSummaries[dateSummaries.length - 1]?.date;
    if (!latestDate || latestDate <= loadedRange.to) {
      setShowAllFuture(true);
      return;
    }
    setExpandingFuture(true);
    try {
      const extra = await fetchGamesForRange(addDaysIso(loadedRange.to, 1), latestDate);
      setGames((prev) => dedupeGamesById([...prev, ...extra]));
      setLoadedRange((r) => (r ? { from: r.from, to: latestDate } : r));
      setShowAllFuture(true);
    } catch (err) {
      console.error(err);
    } finally {
      setExpandingFuture(false);
    }
  }, [loadedRange, expandingFuture, dateSummaries, fetchGamesForRange]);

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

  // Group the currently-loaded games by date (gameDate is serialized as an ISO
  // string, so the first 10 chars are the same UTC-day key the /view=dates summary
  // used — keeps the two phases consistent).
  const gamesByDate = games.reduce((acc, game) => {
    const date = game.gameDate.slice(0, 10);
    if (!acc[date]) acc[date] = [];
    acc[date].push(game);
    return acc;
  }, {} as Record<string, Game[]>);

  // Full date list (loaded or not) comes from the lightweight summary, so "N earlier
  // dates" counts and window boundaries are always correct even before expanding.
  const allDates = dateSummaries.map((d) => d.date);
  const today = todayIso();
  const pastDates = allDates.filter((d) => d <= today);
  const futureDates = allDates.filter((d) => d > today);

  // Most recent game date = latest past date with at least one final result
  let mostRecentGameDate: string | null = null;
  for (let i = pastDates.length - 1; i >= 0; i--) {
    const summary = dateSummaries.find((d) => d.date === pastDates[i]);
    if (summary?.hasFinal) {
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
  const totalGames = dateSummaries.reduce((sum, d) => sum + d.count, 0);

  const expandBtnClass =
    'text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 disabled:opacity-50 disabled:cursor-wait';

  return (
    <div className="max-w-full mx-auto px-3 md:px-4 py-6 md:py-8">
      <div className="mb-4 md:mb-6">
        <Link href={`/${league}/${season}`} className="text-blue-600 hover:text-blue-800 mb-2 inline-block text-sm">
          ← Back to Home
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">ABL Games</h1>
            <p className="text-gray-500 text-xs mt-0.5">{totalGames} games total</p>
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
              onClick={expandPast}
              disabled={expandingPast}
              className={expandBtnClass}
            >
              {expandingPast ? 'Loading…' : `↑ Show ${hiddenPastCount} earlier date${hiddenPastCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
        {visibleDates.map(date => {
          // Sort: user's games first, then others
          const sorted = [...(gamesByDate[date] ?? [])].sort((a, b) => {
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
                {formatDateHeading(date)}
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
                  const awayScoreLine = findScoreForTeam(result?.scores, game, 'away');
                  const homeScoreLine = findScoreForTeam(result?.scores, game, 'home');
                  const awayRegulationRuns = extractRuns(awayScoreLine?.regulation);
                  const homeRegulationRuns = extractRuns(homeScoreLine?.regulation);
                  const awayFinalRuns = extractRuns(awayScoreLine?.final);
                  const homeFinalRuns = extractRuns(homeScoreLine?.final);
                  const awayScore = formatRuns(awayFinalRuns);
                  const homeScore = formatRuns(homeFinalRuns);
                  const wentToXtras =
                    (awayFinalRuns !== null && awayRegulationRuns !== null && awayFinalRuns !== awayRegulationRuns) ||
                    (homeFinalRuns !== null && homeRegulationRuns !== null && homeFinalRuns !== homeRegulationRuns);

                  const isMyGameWon = isMyGame && hasResult && isFinal && result?.winner?._id === userTeamId;
                  const isMyGameLost = isMyGame && hasResult && isFinal && !!result?.winner?._id && result.winner._id !== userTeamId;

                  return (
                    <Link
                      key={game._id}
                      href={`/${league}/${season}/games/${game._id}`}
                      className={`flex-shrink-0 w-44 rounded-lg border p-2.5 hover:shadow-md transition-all text-xs ${
                        isMyGameWon
                          ? 'border-green-400 bg-green-50 hover:border-green-500 dark:bg-green-900/40 dark:border-green-600 dark:hover:border-green-500'
                          : isMyGameLost
                          ? 'border-red-400 bg-red-50 hover:border-red-500 dark:bg-red-900/40 dark:border-red-600 dark:hover:border-red-500'
                          : isMyGame
                          ? 'border-blue-400 bg-blue-50 hover:border-blue-500 dark:bg-blue-900/30 dark:border-blue-600 dark:hover:border-blue-500'
                          : 'border-gray-200 bg-white hover:border-blue-400 dark:bg-gray-800 dark:border-gray-700 dark:hover:border-blue-500'
                      }`}
                    >
                      {/* Away team */}
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className={`font-medium truncate ${hasResult && isFinal && result?.winner?._id === game.awayTeam?._id ? 'text-green-700 dark:text-green-400' : 'text-gray-800 dark:text-gray-100'} ${isMyGame && game.awayTeam?._id === userTeamId ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                          {game.awayTeam?.nickname}
                        </span>
                        <span className="font-mono text-gray-700 dark:text-gray-300 shrink-0">{awayScore ?? '—'}</span>
                      </div>
                      {/* Home team */}
                      <div className="flex items-center justify-between gap-1">
                        <span className={`font-medium truncate ${hasResult && isFinal && result?.winner?._id === game.homeTeam?._id ? 'text-green-700 dark:text-green-400' : 'text-gray-800 dark:text-gray-100'} ${isMyGame && game.homeTeam?._id === userTeamId ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                          {game.homeTeam?.nickname}
                        </span>
                        <span className="font-mono text-gray-700 dark:text-gray-300 shrink-0">{homeScore ?? '—'}</span>
                      </div>
                      {/* Status */}
                      <div className="mt-1.5">
                        {hasResult && isFinal ? (
                          <span className="text-blue-600 dark:text-blue-400 font-medium">{wentToXtras ? 'Final - Xtras' : 'Final'}</span>
                        ) : hasResult ? (
                          <span className="text-yellow-600 dark:text-yellow-400 font-medium">In Progress</span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">Scheduled</span>
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
              onClick={expandFuture}
              disabled={expandingFuture}
              className={expandBtnClass}
            >
              {expandingFuture ? 'Loading…' : `↓ Show ${hiddenFutureCount} more upcoming date${hiddenFutureCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>

      {totalGames === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500 text-sm">No games found</p>
        </div>
      )}
    </div>
  );
}

