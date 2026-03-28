'use client';

import { useEffect, useMemo, useState } from 'react';
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
  description?: string;
}

interface TeamLineupDiff {
  team: string | null;
  location: string | null;
  changedCount: number;
  addedCount: number;
  removedCount: number;
}

interface GameLineupDiff {
  gameId: string;
  gameDate?: string;
  homeTeam?: string;
  awayTeam?: string;
  lineupComparison: {
    changedCount: number;
    addedCount: number;
    removedCount: number;
    teams: TeamLineupDiff[];
  };
}

export default function RecalculatePage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [lineupDiffGames, setLineupDiffGames] = useState<GameLineupDiff[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/games?view=summary')
      .then((r) => r.json())
      .then((data) => setGames(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filteredGames = useMemo(() => {
    return games.filter((game) => {
      const text = `${game.awayTeam?.location || ''} ${game.awayTeam?.nickname || ''} ${game.homeTeam?.location || ''} ${game.homeTeam?.nickname || ''} ${game.description || ''}`.toLowerCase();
      const matchesQuery = !query || text.includes(query.toLowerCase());
      const matchesDate = !selectedDate || game.gameDate?.substring(0, 10) === selectedDate;
      return matchesQuery && matchesDate;
    });
  }, [games, query, selectedDate]);

  const recalcGame = async (gameId: string) => {
    setBusyGameId(gameId);
    setMessage(null);
    try {
      const res = await fetch('/api/games/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setMessage({ type: 'success', text: `Recalculated ${data.processed || 0} game.` });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusyGameId(null);
    }
  };

  const recalcDate = async () => {
    if (!selectedDate) return;
    setBusyDay(selectedDate);
    setMessage(null);
    try {
      const res = await fetch('/api/games/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameDate: selectedDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setMessage({
        type: 'success',
        text: `Processed ${data.processed} games, skipped ${data.skipped}, errors ${data.errors}.`,
      });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusyDay(null);
    }
  };

  const comparePositions = async () => {
    if (!selectedDate) return;
    setCompareBusy(true);
    setLineupDiffGames([]);
    setMessage(null);
    try {
      const res = await fetch('/api/games/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameDate: selectedDate, compareLineups: true, save: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      const diffs: GameLineupDiff[] = (data.summary || []).filter((g: any) => g?.lineupComparison?.hasDiffs);
      setLineupDiffGames(diffs);
      const { gamesCompared = 0, gamesWithDiffs = diffs.length, changedAssignments = 0, addedPlayers = 0, removedPlayers = 0 } = data?.lineupSummary ?? {};
      setMessage({
        type: 'success',
        text: `Compared ${gamesCompared} games. ${gamesWithDiffs} with diffs (changed ${changedAssignments}, added ${addedPlayers}, removed ${removedPlayers}).`,
      });
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setCompareBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Recalculate Games</h1>
        <p className="text-gray-500 text-sm mt-1">
          Recalculate results for individual games or an entire day, or compare stored vs recalculated played positions.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teams…"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={recalcDate}
            disabled={!selectedDate || !!busyDay}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {busyDay ? 'Recalculating…' : 'Recalculate Day'}
          </button>
          <button
            onClick={comparePositions}
            disabled={!selectedDate || compareBusy}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {compareBusy ? 'Comparing…' : 'Compare Positions'}
          </button>
        </div>
        {!selectedDate && (
          <p className="text-xs text-gray-400">Select a date to enable day-level operations.</p>
        )}

        {message && (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${message.type === 'success' ? 'bg-blue-50 border border-blue-200 text-blue-900' : 'bg-red-50 border border-red-200 text-red-800'}`}
          >
            {message.text}
          </div>
        )}
      </div>

      {/* Lineup diffs */}
      {lineupDiffGames.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-900">Played Position Diffs ({lineupDiffGames.length})</h2>
          {lineupDiffGames.map((game) => (
            <div key={game.gameId} className="bg-white rounded-xl shadow-sm border border-amber-200 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-gray-900">
                  {game.awayTeam || 'Away'} @ {game.homeTeam || 'Home'}
                </div>
                <Link href={`/games/${game.gameId}`} className="text-sm text-blue-600 hover:text-blue-800">
                  Open Game →
                </Link>
              </div>
              <div className="text-xs text-gray-500">
                {game.gameDate ? new Date(game.gameDate).toLocaleString() : game.gameId}
              </div>
              <div className="text-xs text-amber-800">
                Changed {game.lineupComparison.changedCount} &bull; Added {game.lineupComparison.addedCount} &bull; Removed {game.lineupComparison.removedCount}
              </div>
              {(game.lineupComparison.teams || []).map((team, idx) => (
                <div key={`${game.gameId}-${team.location || idx}`} className="text-xs text-gray-600 pl-2 border-l-2 border-amber-100">
                  {team.location || 'Team'}: changed {team.changedCount}, added {team.addedCount}, removed {team.removedCount}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Games list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="font-semibold text-gray-900 text-sm">
            {loading ? 'Loading games…' : `${filteredGames.length} game${filteredGames.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        {!loading && filteredGames.length === 0 && (
          <div className="px-5 py-8 text-sm text-gray-400 text-center">No matching games.</div>
        )}

        <div className="divide-y divide-gray-50">
          {filteredGames.map((game) => (
            <div key={game._id} className="px-5 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 text-sm truncate">
                  {game.awayTeam?.location} {game.awayTeam?.nickname} @ {game.homeTeam?.location} {game.homeTeam?.nickname}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {new Date(game.gameDate).toLocaleDateString()}{game.description ? ` · ${game.description}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link href={`/games/${game._id}`} className="text-xs text-blue-600 hover:text-blue-800">
                  View
                </Link>
                <button
                  onClick={() => recalcGame(game._id)}
                  disabled={busyGameId === game._id}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:bg-gray-300 transition-colors"
                >
                  {busyGameId === game._id ? 'Recalculating…' : 'Recalculate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
