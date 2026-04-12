'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLeagueSeason, leagueSeasonQuery } from '@/app/lib/league-season-context';

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
  pb?: number;
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
  const ctx = useLeagueSeason();
  const { league, season } = ctx;

  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('standard');

  useEffect(() => {
    async function fetchStandings() {
      try {
        const res = await fetch(`/api/standings?${leagueSeasonQuery(ctx)}`);
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
  }, [league, season]);

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
    <div className="w-full px-3 py-6 md:px-4 md:py-8">
      <div className="mb-6 md:mb-8">
        <Link href={`/${league}/${season}`} className="text-blue-600 hover:text-blue-800 mb-3 md:mb-4 inline-block text-sm md:text-base">
          ← Back to Home
        </Link>
        <h1 className="text-2xl md:text-4xl font-bold text-gray-900">Standings</h1>
      </div>

      {/* Tabs */}
      <div className="mb-4 md:mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('standard')}
            className={`py-3 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'standard'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Standard
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`py-3 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'advanced'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Advanced
          </button>
        </nav>
      </div>

      {/* Mobile card list */}
      <div className="block md:hidden space-y-2 mb-6">
        {activeTab === 'standard'
          ? standings.map((team, index) => (
              <div key={team._id} className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-400 w-5 shrink-0">#{index + 1}</span>
                    <Link
                      href={`/${league}/${season}/teams/${team.tm._id}`}
                      className="text-blue-600 hover:text-blue-800 font-semibold text-sm truncate"
                    >
                      {team.tm.location} {team.tm.nickname}
                    </Link>
                  </div>
                  <span className={`text-sm font-semibold ml-2 shrink-0 ${team.streak?.startsWith('W') ? 'text-green-600' : 'text-red-600'}`}>
                    {team.streak || '–'}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1.5 pl-7 text-xs text-gray-600">
                  <span className="font-medium text-gray-900">{team.w}–{team.l}</span>
                  <span>{team.wpct}</span>
                  <span>GB: {index === 0 ? '–' : team.gb}</span>
                  {team.l10 && <span>L10: {team.l10}</span>}
                  {team.abl_runs != null && <span>{team.abl_runs.toFixed(1)} R/G</span>}
                </div>
              </div>
            ))
          : standings.map((team) => (
              <div key={team._id} className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <Link
                    href={`/${league}/${season}/teams/${team.tm._id}`}
                    className="text-blue-600 hover:text-blue-800 font-semibold text-sm"
                  >
                    {team.tm.location} {team.tm.nickname}
                  </Link>
                  <span className="text-xs text-gray-600 font-medium">{team.w}–{team.l}</span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                  <span>DougLuck: {team.dougluckw?.toFixed(1) ?? '–'}–{team.dougluckl?.toFixed(1) ?? '–'}</span>
                  <span className={`font-semibold ${(team.dougluckExcessW || 0) > 0 ? 'text-green-600' : (team.dougluckExcessW || 0) < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                    Lucky: {team.dougluckExcessW != null ? (team.dougluckExcessW > 0 ? '+' : '') + team.dougluckExcessW.toFixed(1) : '–'}
                  </span>
                  {team.homeRecord && <span>H: {team.homeRecord}</span>}
                  {team.awayRecord && <span>A: {team.awayRecord}</span>}
                  {team.xtrasRecord && <span>X: {team.xtrasRecord}</span>}
                </div>
              </div>
            ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'standard' ? (
            <StandardStandingsTable standings={standings} league={league} season={season} />
          ) : (
            <AdvancedStandingsTable standings={standings} league={league} season={season} />
          )}
        </div>
      </div>

      <div className="mt-6 md:mt-8 text-sm text-gray-600">
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

function StandardStandingsTable({
  standings,
  league,
  season,
}: {
  standings: Standing[];
  league: string;
  season: string;
}) {
  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
            Team
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">W</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">L</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PCT</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">GB</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">L10</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Streak</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">ABL Runs</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">AB</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">H</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">2B</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">3B</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">HR</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">BB</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">HBP</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">SB(net)</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">SH</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">SF</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">AVG</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">E</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PB</th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {standings.map((team, index) => (
          <tr key={team._id} className="hover:bg-gray-50">
            <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-white">
              <Link
                href={`/${league}/${season}/teams/${team.tm._id}`}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                {team.tm.location} {team.tm.nickname}
              </Link>
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.w}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.l}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.wpct}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-500">
              {index === 0 ? '-' : team.gb}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.l10 || '-'}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm font-semibold">
              <span className={team.streak?.startsWith('W') ? 'text-green-600' : 'text-red-600'}>
                {team.streak || '-'}
              </span>
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.abl_runs?.toFixed(1) || '0.0'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.ab || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.h || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team['2b'] || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team['3b'] || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.hr || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.bb || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.hbp || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{(team.sb || 0) - (team.cs || 0)}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.sac || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.sf || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.batAvg}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.e || 0}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.pb || 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AdvancedStandingsTable({
  standings,
  league,
  season,
}: {
  standings: Standing[];
  league: string;
  season: string;
}) {
  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
            Team
          </th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">W</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">L</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">DougLuck W</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">DougLuck L</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Lucky Wins</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Home Record</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Away Record</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Extra Innings</th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {standings.map((team) => (
          <tr key={team._id} className="hover:bg-gray-50">
            <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-white">
              <Link
                href={`/${league}/${season}/teams/${team.tm._id}`}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                {team.tm.location} {team.tm.nickname}
              </Link>
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.w}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.l}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.dougluckw?.toFixed(1) || '-'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.dougluckl?.toFixed(1) || '-'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm font-semibold">
              <span
                className={
                  (team.dougluckExcessW || 0) > 0
                    ? 'text-green-600'
                    : (team.dougluckExcessW || 0) < 0
                    ? 'text-red-600'
                    : 'text-gray-900'
                }
              >
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
