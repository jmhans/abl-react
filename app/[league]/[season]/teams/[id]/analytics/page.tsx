'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useLeagueSeason } from '@/app/lib/league-season-context';

interface AppearanceCounts {
  starter: number;
  sub: number;
  xtra: number;
  total: number;
}

interface PlayerAnalytics {
  _id: string;
  name: string;
  lineupPosition: string | null;
  designatedStarts: number;
  appearances: AppearanceCounts;
}

interface AnalyticsData {
  teamId: string;
  nickname: string;
  location: string | null;
  lineupChangeCount: number;
  uniqueContributorCount: number;
  scoredGameCount: number;
  players: PlayerAnalytics[];
}

type SortKey = 'total' | 'starter' | 'sub' | 'xtra' | 'designatedStarts';

export default function TeamAnalyticsPage({ embedded = false }: { embedded?: boolean }) {
  const params = useParams();
  const teamId = params.id as string;
  const { league, season } = useLeagueSeason();

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total');

  useEffect(() => {
    fetch(`/api/teams/${teamId}/analytics?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject('Failed to load')))
      .then(setData)
      .catch(() => setError('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [teamId, league, season]);

  const sortedPlayers = data?.players.slice().sort((a, b) => {
    const val = (p: PlayerAnalytics): number => {
      switch (sortKey) {
        case 'starter':          return p.appearances.starter;
        case 'sub':              return p.appearances.sub;
        case 'xtra':             return p.appearances.xtra;
        case 'designatedStarts': return p.designatedStarts;
        default:                 return p.appearances.total;
      }
    };
    const diff = val(b) - val(a);
    if (diff !== 0) return diff;
    return b.appearances.total - a.appearances.total;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-xl text-gray-500">Loading analytics…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-xl text-red-600">{error ?? 'No data'}</div>
      </div>
    );
  }

  function ColHeader({ k, label, title }: { k: SortKey; label: string; title?: string }) {
    const active = sortKey === k;
    return (
      <th className="px-3 py-3 text-center">
        <button
          onClick={() => setSortKey(k)}
          title={title}
          className={`text-xs font-semibold uppercase tracking-wide transition-colors ${
            active
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          {label}
          {active && <span className="ml-0.5">▼</span>}
        </button>
      </th>
    );
  }

  return (
    <div className={embedded ? '' : 'container mx-auto px-4 py-8'}>
      {!embedded && (
        <>
          {/* Back link */}
          <div className="mb-6">
            <Link
              href={`/${league}/${season}/teams/${teamId}`}
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
            >
              ← {[data.location, data.nickname].filter(Boolean).join(' ')}
            </Link>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {data.location && (
                <span className="text-gray-500 dark:text-gray-400 font-normal">{data.location} </span>
              )}
              {data.nickname}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Season Analytics</p>
          </div>
        </>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard value={data.lineupChangeCount} label="Lineup Saves" />
        <StatCard value={data.scoredGameCount} label="Scored Games" />
        <StatCard value={data.uniqueContributorCount} label="Unique Contributors" />
      </div>

      {/* Player table */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Player
              </th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Pos
              </th>
              <ColHeader k="designatedStarts" label="D-Starts" title="Designated starts — times as the starter for their slot" />
              <ColHeader k="starter" label="STR" title="Games activated as Starter (first player at slot)" />
              <ColHeader k="sub"     label="SUB" title="Games activated as Sub (additional player at same slot)" />
              <ColHeader k="xtra"    label="XTR" title="Games activated as XTRA (tie-breaker)" />
              <ColHeader k="total"   label="Total" title="Total ABL appearances (active in scored game)" />
            </tr>
          </thead>
          <tbody>
            {sortedPlayers?.map((p, i) => (
              <tr
                key={p._id}
                className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${
                  i % 2 === 0
                    ? 'bg-white dark:bg-gray-900'
                    : 'bg-gray-50 dark:bg-gray-800'
                }`}
              >
                <td className="px-4 py-2.5 text-sm font-medium text-gray-900 dark:text-white">
                  {p.name}
                </td>
                <td className="px-3 py-2.5 text-sm text-center text-gray-500 dark:text-gray-400">
                  {p.lineupPosition ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-sm text-center text-gray-700 dark:text-gray-300">
                  {p.designatedStarts > 0 ? p.designatedStarts : <Dash />}
                </td>
                <td className="px-3 py-2.5 text-sm text-center text-blue-700 dark:text-blue-400 font-medium">
                  {p.appearances.starter > 0 ? p.appearances.starter : <Dash />}
                </td>
                <td className="px-3 py-2.5 text-sm text-center text-green-700 dark:text-green-400 font-medium">
                  {p.appearances.sub > 0 ? p.appearances.sub : <Dash />}
                </td>
                <td className="px-3 py-2.5 text-sm text-center text-purple-700 dark:text-purple-400 font-medium">
                  {p.appearances.xtra > 0 ? p.appearances.xtra : <Dash />}
                </td>
                <td className="px-3 py-2.5 text-sm text-center font-semibold text-gray-900 dark:text-white">
                  {p.appearances.total > 0 ? p.appearances.total : <Dash />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sortedPlayers?.length === 0 && (
          <p className="text-center text-gray-500 py-12 text-sm">
            No data yet — analytics will appear once games have been scored.
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span>
          <span className="text-blue-600 dark:text-blue-400 font-medium">STR</span> — First player activated at their lineup slot
        </span>
        <span>
          <span className="text-green-600 dark:text-green-400 font-medium">SUB</span> — Additional player added to the same slot
        </span>
        <span>
          <span className="text-purple-600 dark:text-purple-400 font-medium">XTR</span> — Activated in XTRA tie-breaker
        </span>
        <span>
          <span className="font-medium">D-Starts</span> — Times as designated starter for their slot
        </span>
      </div>
    </div>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-5 text-center">
      <div className="text-3xl font-bold text-gray-900 dark:text-white">{value}</div>
      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{label}</div>
    </div>
  );
}

function Dash() {
  return <span className="text-gray-300 dark:text-gray-600">—</span>;
}
