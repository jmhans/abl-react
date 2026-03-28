'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLeagueSeason } from '@/app/lib/league-season-context';

interface Player {
  _id: string;
  name: string;
  team: string;
  eligible?: string[];
  position?: string;
  status?: string;
  abl?: number;
  stats?: any;
}

interface SearchResult {
  _id: string;
  name: string;
  team: string;
  position?: string;
}

export default function FreeAgentsPage() {
  const params = useParams();
  const teamId = params.id as string;
  const { league, season } = useLeagueSeason();

  const [players, setPlayers] = useState<Player[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ilPositions, setIlPositions] = useState<string[]>([]);
  const [selectedPosition, setSelectedPosition] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const fetchILPositions = async () => {
      try {
        const res = await fetch(`/api/teams/${teamId}/il-positions`);
        const data = await res.json();
        setIlPositions(data.ilPositions || []);
        if (data.ilPlayerCount === 0) {
          setError('You must have IL players on your roster to add free agents.');
        }
      } catch (err) {
        console.error('Failed to fetch IL positions:', err);
      }
    };
    fetchILPositions();
  }, [teamId]);

  useEffect(() => {
    fetchPlayers();
  }, [page, search, showAll]);

  const fetchPlayers = async () => {
    try {
      setLoading(true);
      setError('');
      const query = new URLSearchParams();
      query.append('page', page.toString());
      query.append('limit', pageSize.toString());
      if (search) query.append('search', search);
      if (showAll) query.append('showAll', 'true');

      const res = await fetch(`/api/free-agents?${query}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch free agents');
      }

      setPlayers(data.players);
      setTotalPages(data.pagination.pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (value.length >= 2) {
      searchTimeout.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/free-agents/search?q=${encodeURIComponent(value)}`);
          const data = await res.json();
          setSuggestions(data.results || []);
          setShowSuggestions(true);
        } catch (err) {
          console.error('Search failed:', err);
        }
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSuggestionSelect = (player: SearchResult) => {
    setSearch(player.name);
    setSuggestions([]);
    setShowSuggestions(false);
    setPage(1);
  };

  const handleAddPlayer = async (playerId: string, playerName: string, playerEligible: string[]) => {
    if (ilPositions.length === 0) {
      setMessage('❌ You must have IL players on your roster to add free agents.');
      return;
    }
    const matchingPos = playerEligible.find(p => ilPositions.includes(p));
    if (!matchingPos) {
      setMessage(`❌ Player not eligible for any of your IL positions (${ilPositions.join(', ')})`);
      return;
    }
    try {
      setAdding(playerId);
      const res = await fetch(`/api/teams/${teamId}/roster/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, position: matchingPos }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`❌ ${data.error || 'Failed to add player'}`);
      } else {
        setMessage(`✅ Added ${playerName} to roster!`);
        setTimeout(() => { setMessage(''); fetchPlayers(); }, 2000);
      }
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : 'Failed to add player'}`);
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Link href={`/${league}/${season}`} className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to Home
        </Link>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Free Agents</h1>

        <div
          className={`p-4 rounded-lg mb-6 ${
            ilPositions.length > 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
          }`}
        >
          <p className="font-semibold text-lg">
            {ilPositions.length > 0
              ? `✅ Available IL Positions: ${ilPositions.join(', ')}`
              : '❌ No IL players on roster - Cannot add free agents'}
          </p>
        </div>

        {message && (
          <div
            className={`p-3 rounded-lg mb-6 ${
              message.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}
          >
            {message}
          </div>
        )}

        <div className="mb-6">
          <div className="relative mb-4">
            <input
              type="text"
              placeholder="Search players by name or MLB ID..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white border border-gray-300 rounded-lg shadow-lg mt-1 z-10">
                {suggestions.map(player => (
                  <button
                    key={player._id}
                    onClick={() => handleSuggestionSelect(player)}
                    className="w-full text-left px-4 py-2 hover:bg-gray-100 border-b last:border-b-0"
                  >
                    <div className="font-medium">{player.name}</div>
                    <div className="text-sm text-gray-600">{player.team}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => { setShowAll(!showAll); setPage(1); }}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              showAll ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
            }`}
          >
            {showAll ? '✓ Showing all players' : 'Show active only'}
          </button>
          <span className="text-sm text-gray-600">
            {showAll ? 'Showing all players (Active, Injured, Minors)' : 'Showing Active players only'}
          </span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Player</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">MLB Team</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Eligible</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">ABL</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-600">Loading...</td>
              </tr>
            ) : players.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-600">No free agents found</td>
              </tr>
            ) : (
              players.map(player => (
                <tr key={player._id} className="hover:bg-gray-50">
                  <td className="px-4 py-4 text-sm">
                    <div className="font-medium text-gray-900">{player.name}</div>
                    <div className="text-xs text-gray-500">#{player._id?.slice(-6)}</div>
                  </td>
                  <td className="px-4 py-4 text-center text-sm text-gray-900">{player.team}</td>
                  <td className="px-4 py-4 text-center text-sm text-gray-600">
                    {player.eligible?.join(', ') || '--'}
                  </td>
                  <td className="px-4 py-4 text-center text-sm">
                    {player.status ? (
                      <>
                        {player.status.includes('Injured') && (
                          <span className="px-2 py-1 text-xs rounded bg-red-200 text-red-800 font-medium">INJ</span>
                        )}
                        {player.status.includes('Minors') && (
                          <span className="px-2 py-1 text-xs rounded bg-orange-200 text-orange-800 font-medium">MINORS</span>
                        )}
                        {!player.status.includes('Injured') && !player.status.includes('Minors') && (
                          <span className="text-xs text-gray-600">{player.status}</span>
                        )}
                      </>
                    ) : (
                      <span className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-800">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center text-sm font-medium text-gray-900">
                    {player.abl?.toFixed(2) || '0.00'}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <button
                      onClick={() => handleAddPlayer(player._id, player.name, player.eligible || [])}
                      disabled={adding === player._id || ilPositions.length === 0}
                      className="inline-flex items-center px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {adding === player._id ? 'Adding...' : 'Add'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-gray-600">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
