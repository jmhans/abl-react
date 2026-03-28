'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Team {
  _id: string;
  nickname: string;
  location?: string;
}

interface Standing {
  _id: string;
  tm: Team;
  g: number;
  w: number;
  l: number;
  wpct: string;
  gb: string;
  abl_runs?: number;
  ab?: number;
  h?: number;
  '2b'?: number;
  '3b'?: number;
  hr?: number;
  bb?: number;
  hbp?: number;
  sac?: number;
  sf?: number;
  sb?: number;
  cs?: number;
  e?: number;
  era?: number;
  hr_allowed?: number;
  batAvg?: string;
  streak?: string;
  l10?: string;
  dougluckw?: number;
  dougluckl?: number;
  dougluckExcessW?: number;
  homeRecord?: string;
  awayRecord?: string;
  xtrasRecord?: string;
}

type TabType = 'standard' | 'advanced';

export default function StandingsPage() {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('standard');

  useEffect(() => {
    async function fetchStandings() {
      try {
        const res = await fetch('/api/standings');
        if (!res.ok) {
          throw new Error('Failed to fetch standings');
        }
        const data = await res.json();
        setStandings(data);
      } catch (err) {
        setError('Failed to load standings');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchStandings();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading standings...</div>
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

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-gray-900 mb-8">Standings</h1>

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('standard')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'standard'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Standard
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'advanced'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Advanced
          </button>
        </nav>
      </div>

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'standard' ? (
            <StandardStandingsTable standings={standings} />
          ) : (
            <AdvancedStandingsTable standings={standings} />
          )}
        </div>
      </div>

      <div className="mt-8 text-sm text-gray-600">
        {activeTab === 'standard' ? (
          <>
            <p className="mb-2">
              <strong>Streak:</strong> Current winning (W) or losing (L) streak
            </p>
            <p className="mb-2">
              <strong>L10:</strong> Record in last 10 games
            </p>
            <p>
              <strong>ABL Runs:</strong> Average ABL runs per game
            </p>
          </>
        ) : (
          <>
            <p className="mb-2">
              <strong>DougLuck:</strong> Expected wins/losses based on run differential
            </p>
            <p className="mb-2">
              <strong>Lucky Wins:</strong> Actual wins minus expected wins (positive = lucky)
            </p>
            <p>
              <strong>Splits:</strong> Performance in different game situations
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function StandardStandingsTable({ standings }: { standings: Standing[] }) {
  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
            Team
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            W
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            L
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            PCT
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            GB
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            L10
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            Streak
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            ABL Runs
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            AB
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            H
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            AVG
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            HR
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            E
          </th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {standings.map((team, index) => (
          <tr key={team._id} className="hover:bg-gray-50">
            <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-white">
              <Link
                href={`/teams/${team.tm._id}`}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                {team.tm.location} {team.tm.nickname}
              </Link>
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.w}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.l}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.wpct}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-500">
              {index === 0 ? '-' : team.gb}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.l10 || '-'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm font-semibold">
              <span className={team.streak?.startsWith('W') ? 'text-green-600' : 'text-red-600'}>
                {team.streak || '-'}
              </span>
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.abl_runs?.toFixed(1) || '0.0'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.ab || 0}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.h || 0}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.batAvg}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.hr || 0}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.e || 0}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AdvancedStandingsTable({ standings }: { standings: Standing[] }) {
  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
            Team
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            W
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            L
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            DougLuck W
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            DougLuck L
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            Lucky Wins
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            Home Record
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            Away Record
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            Extra Innings
          </th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {standings.map((team) => (
          <tr key={team._id} className="hover:bg-gray-50">
            <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-white">
              <Link
                href={`/teams/${team.tm._id}`}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                {team.tm.location} {team.tm.nickname}
              </Link>
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.w}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.l}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.dougluckw?.toFixed(1) || '-'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.dougluckl?.toFixed(1) || '-'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm font-semibold">
              <span className={
                (team.dougluckExcessW || 0) > 0 ? 'text-green-600' : 
                (team.dougluckExcessW || 0) < 0 ? 'text-red-600' : 
                'text-gray-900'
              }>
                {team.dougluckExcessW?.toFixed(1) || '0.0'}
              </span>
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.homeRecord || '-'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.awayRecord || '-'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.xtrasRecord || '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
