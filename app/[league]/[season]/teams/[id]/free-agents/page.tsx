'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLeagueSeason } from '@/app/lib/league-season-context';
import type { ProjectionStats } from '@/app/lib/projection-utils';

interface Player {
  _id: string;
  name: string;
  team: string;
  eligible?: string[];
  position?: string;
  status?: string;
  abl?: number;
  ablProjected?: number | null;
  projSystem?: string | null;
  projStats?: ProjectionStats | null;
  stats?: any;
}

interface SearchResult {
  _id: string;
  name: string;
  team: string;
  position?: string;
}

type DisplayStats = {
  g: number | null;
  ab: number | null;
  h: number | null;
  doubles: number | null;
  triples: number | null;
  hr: number | null;
  bb: number | null;
  hbp: number | null;
  netSb: number | null;
  sh: number | null;
  sf: number | null;
  ablScore: number | null;
};

function getDisplayStats(player: Player, view: string): DisplayStats {
  if (view === 'actual') {
    const b = player.stats?.batting;
    const ab = b?.atBats ?? 0;
    const bb = b?.baseOnBalls ?? 0;
    const hbp = b?.hitByPitch ?? 0;
    const sb = b?.stolenBases ?? null;
    const cs = b?.caughtStealing ?? null;
    return {
      g: (b?.gamesPlayed || null),
      ab: ab > 0 ? ab : null,
      h: b?.hits ?? null,
      doubles: b?.doubles ?? null,
      triples: b?.triples ?? null,
      hr: b?.homeRuns ?? null,
      bb: bb > 0 ? bb : null,
      hbp: hbp > 0 ? hbp : null,
      netSb: (sb !== null || cs !== null) ? (sb ?? 0) - (cs ?? 0) : null,
      sh: b?.sacrificeBunts ?? null,
      sf: b?.sacrificeFlies ?? null,
      ablScore: player.abl ?? null,
    };
  }
  const p = player.projStats;
  const sb = p?.sb ?? null;
  const cs = p?.cs ?? null;
  return {
    g: p?.g ?? null,
    ab: p?.ab ?? null,
    h: p?.h ?? null,
    doubles: p?.doubles ?? null,
    triples: p?.triples ?? null,
    hr: p?.hr ?? null,
    bb: p?.bb ?? null,
    hbp: p?.hbp ?? null,
    netSb: (sb !== null || cs !== null) ? (sb ?? 0) - (cs ?? 0) : null,
    sh: p?.sacBunts ?? null,
    sf: p?.sacFlies ?? null,
    ablScore: player.ablProjected ?? null,
  };
}

type SortColKey = 'g' | 'ab' | 'h' | 'doubles' | 'triples' | 'hr' | 'bb' | 'hbp' | 'netSb' | 'sh' | 'sf' | 'abl';
const STAT_COL_KEYS: SortColKey[] = ['g', 'ab', 'h', 'doubles', 'triples', 'hr', 'bb', 'hbp', 'netSb', 'sh', 'sf'];

const STAT_COLS = ['G', 'AB', 'H', '2B', '3B', 'HR', 'BB', 'HBP', 'SB(net)', 'SH', 'SF'] as const;
// xs: Player | ABL | Action
// sm: Player | AB | ABL | Action
// md+: Player | G AB H 2B 3B HR BB HBP SB NB SH SF | ABL | Action (14 cols)
const GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem_4rem] sm:grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_4rem] md:grid-cols-[minmax(0,2fr)_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_4.5rem_4rem]';
const STAT_VIS = ['hidden md:block', 'hidden sm:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden lg:block', 'hidden lg:block'] as const;

export default function FreeAgentsPage() {
  const params = useParams();
  const teamId = params.id as string;
  const { league, season } = useLeagueSeason();

  const [players, setPlayers] = useState<Player[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(1000);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ilPositions, setIlPositions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [seasonStatus, setSeasonStatus] = useState<string | null>(null);
  const [statView, setStatView] = useState<string>('actual');
  const [projSystems, setProjSystems] = useState<string[]>([]);
  const [projLoading, setProjLoading] = useState(false);
  const [sortCol, setSortCol] = useState<SortColKey | null>(null);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    fetch(`/api/seasons?league=${league}&year=${season}`)
      .then(r => r.json())
      .then((data: any[]) => setSeasonStatus(data[0]?.status ?? null))
      .catch(() => {});
  }, [league, season]);

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

  // Load available projection systems — identical pattern to draft page
  useEffect(() => {
    fetch('/api/projections')
      .then(r => r.json())
      .then((data: any) => {
        const seasonNum = Number(season);
        const systems: string[] = (data.summary as Array<{ _id: { season: number; projSystem: string } }>)
          .filter(s => s._id.season === seasonNum)
          .map(s => s._id.projSystem);
        setProjSystems(systems);
        // Do NOT auto-switch statView here — actual stats should be the default.
        // The dropdown lets the user switch when they want projections.
      })
      .catch(err => console.error('Failed to load projection systems:', err));
  }, [season]);

  const fetchPlayers = useCallback(async (view?: string) => {
    const myId = ++fetchIdRef.current;
    try {
      setLoading(true);
      setError('');
      const currentView = view ?? statView;
      const query = new URLSearchParams();
      query.append('page', page.toString());
      query.append('limit', pageSize.toString());
      if (search) query.append('search', search);
      if (showAll) query.append('showAll', 'true');
      if (currentView !== 'actual') query.append('projSystem', currentView);
      if (league) query.append('league', league);
      if (season) query.append('season', season);
      if (selectedPositions.length > 0) query.append('positions', selectedPositions.join(','));

      const res = await fetch(`/api/free-agents?${query}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch free agents');
      }

      if (myId !== fetchIdRef.current) return; // stale response — a newer fetch is in flight

      setPlayers(data.players);
      setTotalPages(data.pagination.pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, search, showAll, statView, pageSize, selectedPositions]);

  useEffect(() => {
    fetchPlayers();
  }, [page, search, showAll, statView, selectedPositions]);

  const handleStatViewChange = (newView: string) => {
    setStatView(newView);
    setSortCol(null);
    setSortDir('desc');
    setPage(1);
  };

  const handleColSort = (col: SortColKey) => {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortDir('asc');
    } else {
      setSortCol(null);
      setSortDir('desc');
    }
  };

  const togglePosition = (position: string) => {
    setSelectedPositions(prev => {
      const newPositions = prev.includes(position)
        ? prev.filter(p => p !== position)
        : [...prev, position];
      setPage(1); // Reset to page 1 when filter changes
      return newPositions;
    });
  };

  const clearPositions = () => {
    setSelectedPositions([]);
    setPage(1);
  };

  const sortedPlayers = useMemo(() => {
    const getVal = (player: Player, col: SortColKey): number | null => {
      const ds = getDisplayStats(player, statView);
      return col === 'abl' ? ds.ablScore : ds[col];
    };
    return [...players].sort((a, b) => {
      if (!sortCol) {
        // Default: ABL descending
        const av = (statView === 'actual' ? a.abl : a.ablProjected) ?? -Infinity;
        const bv = (statView === 'actual' ? b.abl : b.ablProjected) ?? -Infinity;
        return bv - av;
      }
      const nullVal = sortDir === 'desc' ? -Infinity : Infinity;
      const av = getVal(a, sortCol) ?? nullVal;
      const bv = getVal(b, sortCol) ?? nullVal;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [players, sortCol, sortDir, statView]);

  const downloadCsv = () => {
    const fmt = (v: number | null) => v === null ? '' : String(Math.round(v));
    const fmtAbl = (v: number | null) => v === null ? '' : v.toFixed(2);
    const escape = (s: string) => s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;

    const statLabel = statView !== 'actual' ? `ABL(${statView})` : 'ABL';
    const headers = ['Name', 'Team', 'Eligible', 'Status', 'G', 'AB', 'H', '2B', '3B', 'HR', 'BB', 'HBP', 'SB(net)', 'SH', 'SF', statLabel];
    const rows = sortedPlayers.map(player => {
      const ds = getDisplayStats(player, statView);
      return [
        escape(player.name),
        escape(player.team || 'FA'),
        escape(player.eligible?.join(';') || ''),
        escape(player.status || ''),
        fmt(ds.g), fmt(ds.ab), fmt(ds.h), fmt(ds.doubles), fmt(ds.triples),
        fmt(ds.hr), fmt(ds.bb), fmt(ds.hbp), fmt(ds.netSb), fmt(ds.sh), fmt(ds.sf),
        fmtAbl(ds.ablScore),
      ];
    });

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    // Encode as UTF-8 with BOM to fix character encoding issues (e.g., "Ã" appearing instead of accented chars)
    const encoder = new TextEncoder();
    const utf8Bom = new Uint8Array([0xEF, 0xBB, 0xBF]); // UTF-8 BOM
    const csvBytes = encoder.encode(csv);
    const blob = new Blob([utf8Bom, csvBytes], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `free-agents-${statView}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sortIcon = (col: SortColKey) => {
    if (sortCol !== col) return <span className="ml-0.5 opacity-20">↕</span>;
    return <span className="ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
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

        {seasonStatus === 'pre-draft' && (
          <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-6">
            <p className="text-yellow-900 font-semibold">⏳ Draft hasn&apos;t happened yet</p>
            <p className="text-yellow-800 text-sm mt-1">
              Players cannot be added until after the draft. Check back once the draft is complete.
            </p>
          </div>
        )}

        <div
          className={`p-4 rounded-lg mb-6 ${
            ilPositions.length > 0 ? 'bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700' : 'bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700'
          }`}
        >
          <p className={`font-semibold text-lg ${ilPositions.length > 0 ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'}`}>
            {ilPositions.length > 0
              ? `✅ Available IL Positions: ${ilPositions.join(', ')}`
              : '❌ No IL players on roster - Cannot add free agents'}
          </p>
        </div>

        {message && (
          <div
            className={`p-3 rounded-lg mb-6 ${
              message.includes('✅') ? 'bg-green-50 dark:bg-green-900 text-green-900 dark:text-green-100 border border-green-200 dark:border-green-700' : 'bg-red-50 dark:bg-red-900 text-red-900 dark:text-red-100 border border-red-200 dark:border-red-700'
            }`}
          >
            {message}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center mb-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Search players by name..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64"
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

          <button
            onClick={() => { setShowAll(!showAll); setPage(1); }}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              showAll ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
            }`}
          >
            {showAll ? '✓ Showing all players' : 'Active only'}
          </button>

          <select
            value={statView}
            onChange={e => handleStatViewChange(e.target.value)}
            disabled={projLoading}
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="actual">Actual (YTD)</option>
            {projSystems.map(sys => (
              <option key={sys} value={sys}>Proj: {sys}</option>
            ))}
          </select>
        </div>

        {/* Position Filter */}
        <div className="mb-4">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-gray-600">Positions:</span>
            {['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'].map(pos => (
              <button
                key={pos}
                onClick={() => togglePosition(pos)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedPositions.includes(pos)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {pos}
              </button>
            ))}
            {selectedPositions.length > 0 && (
              <button
                onClick={clearPositions}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 transition-colors ml-auto"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex justify-end mt-2">
            <button
              onClick={downloadCsv}
              disabled={sortedPlayers.length === 0}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⬇ Download CSV ({sortedPlayers.length})
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}
      </div>

      {/* Player grid */}
      <div className="overflow-auto rounded-lg border border-gray-200 bg-white shadow">
        {/* Header */}
        <div className={`${GRID} gap-x-2 sticky top-0 z-10 border-b bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500`}>
          <div>Player</div>
          {STAT_COLS.map((col, i) => (
            <button
              key={col}
              onClick={() => handleColSort(STAT_COL_KEYS[i])}
              className={`text-center cursor-pointer hover:text-gray-800 select-none ${STAT_VIS[i]}`}
            >
              {col}{sortIcon(STAT_COL_KEYS[i])}
            </button>
          ))}
          <button
            onClick={() => handleColSort('abl')}
            className={`text-center cursor-pointer hover:opacity-80 select-none ${statView !== 'actual' ? 'text-blue-600' : 'text-green-700'}`}
          >
            {statView !== 'actual' ? 'ABL★' : 'ABL'}{sortIcon('abl')}
          </button>
          <div />
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-10 text-center text-gray-500">Loading...</div>
        ) : sortedPlayers.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-500">No free agents found</div>
        ) : (
          sortedPlayers.map(player => {
            const ds = getDisplayStats(player, statView);
            const fmt = (v: number | null) => v === null ? '—' : String(Math.round(v));
            const ablColor = ds.ablScore === null ? 'text-gray-300'
              : ds.ablScore >= 0
                ? (statView !== 'actual' ? 'text-blue-700' : 'text-green-700')
                : 'text-red-500';
            const statC = (v: number | null) => v === null ? 'text-gray-300' : 'text-gray-700';
            return (
              <div
                key={player._id}
                className={`${GRID} gap-x-2 items-center border-b px-4 py-2 text-sm last:border-b-0 hover:bg-gray-50`}
              >
                <div>
                  <div className="font-medium text-gray-900 leading-tight">{player.name}</div>
                  <div className="text-xs text-gray-500">{player.team || 'FA'} – {player.eligible?.join(', ') || '—'}</div>
                  {player.status && <div className="text-xs text-gray-400">{player.status}</div>}
                </div>
                <div className={`text-center text-xs ${STAT_VIS[0]} ${statC(ds.g)}`}>{fmt(ds.g)}</div>
                <div className={`text-center text-xs ${STAT_VIS[1]} ${statC(ds.ab)}`}>{fmt(ds.ab)}</div>
                <div className={`text-center text-xs ${STAT_VIS[2]} ${statC(ds.h)}`}>{fmt(ds.h)}</div>
                <div className={`text-center text-xs ${STAT_VIS[3]} ${statC(ds.doubles)}`}>{fmt(ds.doubles)}</div>
                <div className={`text-center text-xs ${STAT_VIS[4]} ${statC(ds.triples)}`}>{fmt(ds.triples)}</div>
                <div className={`text-center text-xs ${STAT_VIS[5]} ${statC(ds.hr)}`}>{fmt(ds.hr)}</div>
                <div className={`text-center text-xs ${STAT_VIS[6]} ${statC(ds.bb)}`}>{fmt(ds.bb)}</div>
                <div className={`text-center text-xs ${STAT_VIS[7]} ${statC(ds.hbp)}`}>{fmt(ds.hbp)}</div>
                <div className={`text-center text-xs ${STAT_VIS[8]} ${statC(ds.netSb)}`}>{fmt(ds.netSb)}</div>
                <div className={`text-center text-xs ${STAT_VIS[9]} ${statC(ds.sh)}`}>{fmt(ds.sh)}</div>
                <div className={`text-center text-xs ${STAT_VIS[10]} ${statC(ds.sf)}`}>{fmt(ds.sf)}</div>
                <div className={`text-center text-xs font-medium ${ablColor}`}>
                  {ds.ablScore !== null ? ds.ablScore.toFixed(2) : '—'}
                </div>
                <div className="flex justify-end">
                  {seasonStatus === 'pre-draft' ? (
                    <span className="text-xs text-yellow-700 font-medium">Pre-Draft</span>
                  ) : (
                    <button
                      onClick={() => handleAddPlayer(player._id, player.name, player.eligible || [])}
                      disabled={adding === player._id || ilPositions.length === 0}
                      className="rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {adding === player._id ? '…' : 'Add'}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>


    </div>
  );
}