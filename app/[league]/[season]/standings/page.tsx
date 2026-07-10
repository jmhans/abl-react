'use client';

import { useEffect, useMemo, useState } from 'react';
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

type TabType = 'standard' | 'advanced' | 'headToHead' | 'simulated';

interface SimulationResult {
  calculatedAt: string;
  numScenarios: number;
  teamStats: Record<string, { mean: number; std: number; n: number }>;
  positionMatrix: Record<string, Record<string, number>>;
  projectedWins: Record<string, number>;
  teamNames: Record<string, string>;
  teamOrder: string[];
  durationMs: number;
}

interface Game {
  result?: {
    isFinal?: boolean;
    winner?: TeamReference;
    loser?: TeamReference;
  };
}

type TeamReference =
  | string
  | {
      _id?: string | { $oid?: string };
      $oid?: string;
    };

type HeadToHeadMatrix = Record<string, Record<string, string>>;

function getTeamId(value: TeamReference | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;

  const maybeTeam = value as { _id?: unknown; $oid?: unknown };
  if (typeof maybeTeam._id === 'string') return maybeTeam._id;
  if (typeof maybeTeam.$oid === 'string') return maybeTeam.$oid;

  if (maybeTeam._id && typeof maybeTeam._id === 'object') {
    const nested = maybeTeam._id as { $oid?: unknown };
    if (typeof nested.$oid === 'string') return nested.$oid;
  }

  return null;
}

function buildHeadToHeadMatrix(standings: Standing[], games: Game[]): HeadToHeadMatrix {
  const teamIds = standings.map(team => team.tm._id);
  const teamIdSet = new Set(teamIds);
  const counters: Record<string, Record<string, { w: number; l: number }>> = {};

  for (const teamId of teamIds) {
    counters[teamId] = {};
    for (const opponentId of teamIds) {
      counters[teamId][opponentId] = { w: 0, l: 0 };
    }
  }

  for (const game of games) {
    if (game.result?.isFinal === false) continue;

    const winnerId = getTeamId(game.result?.winner);
    const loserId = getTeamId(game.result?.loser);

    if (!winnerId || !loserId || winnerId === loserId) continue;
    if (!teamIdSet.has(winnerId) || !teamIdSet.has(loserId)) continue;

    counters[winnerId][loserId].w += 1;
    counters[loserId][winnerId].l += 1;
  }

  const matrix: HeadToHeadMatrix = {};
  for (const teamId of teamIds) {
    matrix[teamId] = {};
    for (const opponentId of teamIds) {
      if (teamId === opponentId) {
        matrix[teamId][opponentId] = '—';
        continue;
      }
      const record = counters[teamId][opponentId];
      const totalGames = record.w + record.l;
      matrix[teamId][opponentId] = totalGames > 0 ? `${record.w}-${record.l}` : '—';
    }
  }

  return matrix;
}

export default function StandingsPage() {
  const ctx = useLeagueSeason();
  const { league, season } = ctx;

  const [standings, setStandings] = useState<Standing[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('standard');
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simNotFound, setSimNotFound] = useState(false);
  const seasonQuery = useMemo(() => leagueSeasonQuery(ctx), [ctx]);
  const headToHeadMatrix = useMemo(
    () => (activeTab === 'headToHead' ? buildHeadToHeadMatrix(standings, games) : {}),
    [activeTab, standings, games]
  );

  useEffect(() => {
    async function fetchStandings() {
      try {
        const [standingsRes, gamesRes] = await Promise.all([
          fetch(`/api/standings?${seasonQuery}`),
          fetch(`/api/games?${seasonQuery}&gameType=R`),
        ]);

        if (!standingsRes.ok || !gamesRes.ok) {
          if (!standingsRes.ok && !gamesRes.ok) {
            throw new Error('Failed to load standings and head-to-head records');
          }
          if (!standingsRes.ok) {
            throw new Error('Failed to load standings');
          }
          throw new Error('Failed to load head-to-head records');
        }

        const [standingsData, gamesData] = await Promise.all([standingsRes.json(), gamesRes.json()]);
        setStandings(standingsData);
        setGames(gamesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load standings');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchStandings();
  }, [seasonQuery]);

  // Lazy-load simulation results only when that tab is first opened
  useEffect(() => {
    if (activeTab !== 'simulated' || simResult || simLoading || simError) return;
    setSimLoading(true);
    setSimError(null);
    fetch(`/api/simulate-standings?${seasonQuery}`)
      .then(async (res) => {
        if (res.status === 404) { setSimNotFound(true); return null; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? 'Failed to load simulation results');
        }
        return res.json();
      })
      .then((data) => { if (data) setSimResult(data); })
      .catch((err) => setSimError(err.message))
      .finally(() => setSimLoading(false));
  }, [activeTab, seasonQuery, simResult, simLoading]);

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
          <button
            onClick={() => setActiveTab('headToHead')}
            className={`py-3 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'headToHead'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Head-to-Head
          </button>
          <button
            onClick={() => setActiveTab('simulated')}
            className={`py-3 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'simulated'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Simulated
          </button>
        </nav>
      </div>

      {/* Simulated standings tab */}
      {activeTab === 'simulated' && (
        <SimulatedStandingsPanel
          simResult={simResult}
          simLoading={simLoading}
          simError={simError}
          simNotFound={simNotFound}
          seasonQuery={seasonQuery}
        />
      )}

      {/* Mobile card list */}
      {activeTab !== 'simulated' && (activeTab === 'headToHead' ? (
        <div className="md:hidden bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto mb-6">
          <HeadToHeadStandingsTable standings={standings} league={league} season={season} matrix={headToHeadMatrix} />
        </div>
      ) : (
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
                  {team.abl_runs != null && <span>{team.abl_runs.toFixed(2)} R/G</span>}
                  {team.era != null && <span>ERA: {team.era.toFixed(2)}</span>}
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
      ))}

      {/* Desktop table */}
      {activeTab !== 'simulated' && (
        <div className="hidden md:block bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            {activeTab === 'standard' ? (
              <StandardStandingsTable standings={standings} league={league} season={season} />
            ) : activeTab === 'advanced' ? (
              <AdvancedStandingsTable standings={standings} league={league} season={season} />
            ) : (
              <HeadToHeadStandingsTable standings={standings} league={league} season={season} matrix={headToHeadMatrix} />
            )}
          </div>
        </div>
      )}

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
            <p>
              <strong>ERA:</strong> Average earned runs allowed per game (runs against minus errors and passed balls)
            </p>
          </>
        ) : activeTab === 'advanced' ? (
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
        ) : (
          <p>
            <strong>Head-to-Head:</strong> Each cell shows a team&apos;s record versus that opponent.
          </p>
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
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">ERA</th>
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
              {team.abl_runs?.toFixed(2) || '0.00'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.era != null ? team.era.toFixed(2) : '-'}
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
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">DougLuck W</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">DougLuck L</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">W</th>
          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">L</th>
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
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.dougluckw?.toFixed(1) || '-'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">
              {team.dougluckl?.toFixed(1) || '-'}
            </td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.w}</td>
            <td className="px-3 py-4 whitespace-nowrap text-center text-sm text-gray-900">{team.l}</td>
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

function HeadToHeadStandingsTable({
  standings,
  league,
  season,
  matrix,
}: {
  standings: Standing[];
  league: string;
  season: string;
  matrix: HeadToHeadMatrix;
}) {
  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
            Team
          </th>
          {standings.map((opponent) => (
            <th key={opponent.tm._id} className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
              {opponent.tm.nickname}
            </th>
          ))}
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
            {standings.map((opponent) => (
              <td
                key={`${team.tm._id}-${opponent.tm._id}`}
                className={`px-3 py-4 whitespace-nowrap text-center text-sm ${
                  team.tm._id === opponent.tm._id ? 'text-gray-400 font-medium' : 'text-gray-900'
                }`}
              >
                {matrix[team.tm._id]?.[opponent.tm._id] ?? '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Simulated Standings Panel
// ---------------------------------------------------------------------------

function probColor(p: number): string {
  return `rgba(59,130,246,${p.toFixed(2)})`;
}

function probTextColor(p: number): string {
  return p >= 0.5 ? 'text-white' : 'text-gray-900';
}

function SimulatedStandingsPanel({
  simResult,
  simLoading,
  simError,
  simNotFound,
  seasonQuery,
}: {
  simResult: SimulationResult | null;
  simLoading: boolean;
  simError: string | null;
  simNotFound: boolean;
  seasonQuery: string;
}) {
  if (simLoading) {
    return <div className="py-12 text-center text-gray-500">Loading simulation results…</div>;
  }

  if (simNotFound) {
    return (
      <div className="py-12 text-center text-gray-500">
        <p className="font-medium text-gray-700">No simulation results yet.</p>
        <p className="text-sm mt-2">
          An admin can seed them by calling:
        </p>
        <code className="block mt-2 bg-gray-100 rounded px-3 py-2 text-xs text-gray-700 inline-block">
          POST /api/simulate-standings?{seasonQuery}&scenarios=1
        </code>
      </div>
    );
  }

  if (simError) {
    return (
      <div className="py-12 text-center text-red-600">
        <p className="font-medium">Could not load simulation results.</p>
        <p className="text-sm mt-1">{simError}</p>
      </div>
    );
  }

  if (!simResult) return null;

  const { teamOrder, teamNames, teamStats, positionMatrix, projectedWins, numScenarios, calculatedAt } = simResult;
  const numTeams = teamOrder.length;
  const positions = Array.from({ length: numTeams }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
        <span>
          <strong className="text-gray-700">{numScenarios.toLocaleString()}</strong> scenarios
        </span>
        <span>
          Last run:{' '}
          <strong className="text-gray-700">
            {new Date(calculatedAt).toLocaleString()}
          </strong>
        </span>
      </div>

      {/* Finish-position probability matrix */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-3">Finish Position Probabilities</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 whitespace-nowrap">
                  Team
                </th>
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Proj W
                </th>
                {positions.map((pos) => (
                  <th
                    key={pos}
                    className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    #{pos}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {teamOrder.map((teamId) => {
                const name = teamNames[teamId] ?? teamId;
                const projW = projectedWins[teamId] ?? 0;
                const probs = positionMatrix[teamId] ?? {};
                return (
                  <tr key={teamId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900 sticky left-0 bg-white">
                      {name}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-center text-gray-700">
                      {projW.toFixed(1)}
                    </td>
                    {positions.map((pos) => {
                      const p = probs[String(pos)] ?? 0;
                      return (
                        <td
                          key={pos}
                          className={`px-3 py-3 whitespace-nowrap text-center font-medium ${probTextColor(p)}`}
                          style={{ backgroundColor: probColor(p) }}
                        >
                          {p > 0 ? `${(p * 100).toFixed(1)}%` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Team offensive stats */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-3">Offensive Profile (used in simulation)</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">Team</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Mean Runs</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Std Dev</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Game-Days</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {teamOrder.map((teamId) => {
                const stats = teamStats[teamId];
                return (
                  <tr key={teamId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900 sticky left-0 bg-white">
                      {teamNames[teamId] ?? teamId}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-center text-gray-700">
                      {stats ? stats.mean.toFixed(3) : '—'}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-center text-gray-700">
                      {stats ? stats.std.toFixed(3) : '—'}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-center text-gray-700">
                      {stats ? stats.n : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Runs scored sampled from Normal(mean, std) per team. Regulation only; home team advantage (+0.5) excluded from sample.
        One game-day per team per calendar day to avoid lineup duplication.
      </p>
    </div>
  );
}
