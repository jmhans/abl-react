'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLeagueSeason } from '@/app/lib/league-season-context';

interface Team {
  _id: string;
  nickname: string;
  location?: string;
}

interface PlayerStats {
  g?: number;
  ab?: number;
  h?: number;
  '2b'?: number;
  '3b'?: number;
  hr?: number;
  bb?: number;
  ibb?: number;
  hbp?: number;
  sb?: number;
  cs?: number;
  sac?: number;
  sf?: number;
  po?: number;
  e?: number;
  pb?: number;
  abl_points?: number;
}

interface Player {
  _id: string;
  name: string;
  position?: string;
  eligible?: string[];
  mlbTeam?: string | null;
  ablPlayedType?: string | null;
  dailyStats?: PlayerStats;
  playedPosition?: string;
  lineupPosition?: string;
  lineupOrder?: number;
  rosterOrder?: number;
}

interface MlbGameStatus {
  awayTeam: string;
  homeTeam: string;
  state: 'Preview' | 'Live' | 'Final';
  inning: number | null;
  inningState: string | null;
  awayRuns: number | null;
  homeRuns: number | null;
}

type TeamStatusMap = Map<string, MlbGameStatus>;

interface GameRoster {
  homeTeam: Player[];
  awayTeam: Player[];
  home_score: { regulation: any; final: any };
  away_score: { regulation: any; final: any };
  result?: { winner: Team; loser: Team; isFinal?: boolean };
  status: string;
}

interface Game {
  _id: string;
  gameDate: string;
  awayTeam: Team;
  homeTeam: Team;
  description?: string;
}

function getAblRuns(finalScore: any): number | null {
  if (typeof finalScore === 'number' && Number.isFinite(finalScore)) {
    return finalScore;
  }
  if (finalScore && typeof finalScore === 'object') {
    if (typeof finalScore.abl_runs === 'number' && Number.isFinite(finalScore.abl_runs)) {
      return finalScore.abl_runs;
    }
    if (typeof finalScore.final === 'number' && Number.isFinite(finalScore.final)) {
      return finalScore.final;
    }
  }
  return null;
}

function getFinalStat(finalScore: any, key: string): string {
  if (finalScore && typeof finalScore === 'object' && finalScore[key] !== undefined && finalScore[key] !== null) {
    return String(finalScore[key]);
  }
  return '—';
}

export default function GameDetailPage() {
  const params = useParams();
  const gameId = params.id as string;
  const { league, season } = useLeagueSeason();

  const [game, setGame] = useState<Game | null>(null);
  const [rosters, setRosters] = useState<GameRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);
  const [teamStatusMap, setTeamStatusMap] = useState<TeamStatusMap>(new Map());
  const [showDetails, setShowDetails] = useState(false);

  const fetchGame = useCallback(async () => {
    try {
      const [gameRes, rostersRes, adminRes] = await Promise.all([
        fetch(`/api/games/${gameId}`),
        fetch(`/api/games/${gameId}/rosters`),
        fetch('/api/admin/me'),
      ]);

      if (!gameRes.ok) {
        const body = await gameRes.json().catch(() => ({}));
        throw new Error(
          gameRes.status === 404
            ? 'Game not found'
            : `Game request failed (${gameRes.status}): ${body?.error ?? 'unknown'}`
        );
      }
      if (!rostersRes.ok) {
        const body = await rostersRes.json().catch(() => ({}));
        throw new Error(`Rosters request failed (${rostersRes.status}): ${body?.error ?? 'unknown'}`);
      }

      const gameData = await gameRes.json();
      const rostersData = await rostersRes.json();

      if (adminRes.ok) {
        const adminData = await adminRes.json();
        setIsAdmin(Boolean(adminData?.isAdmin));
      }

      setGame(gameData);
      setRosters(rostersData);

      // Fetch live MLB game statuses for the game date
      try {
        const dateStr = new Date(gameData.gameDate).toISOString().slice(0, 10);
        const mlbResp = await fetch(`/api/mlb/schedule?date=${dateStr}`);
        if (mlbResp.ok) {
          const mlbData = await mlbResp.json();
          const map = new Map<string, MlbGameStatus>();
          for (const g of (mlbData.games ?? []) as MlbGameStatus[]) {
            if (g.awayTeam) map.set(g.awayTeam, g);
            if (g.homeTeam) map.set(g.homeTeam, g);
          }
          setTeamStatusMap(map);
        }
      } catch {
        // non-critical — status badges simply won't show
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load game details';
      setError(msg);
      console.error('fetchGame error:', err);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  const recalculateGame = async () => {
    if (!gameId) return;
    setRecalcBusy(true);
    setRecalcMessage(null);
    try {
      const response = await fetch('/api/games/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to recalculate game');
      }
      setRecalcMessage('Game result recalculated.');
      setLoading(true);
      await fetchGame();
    } catch (err) {
      setRecalcMessage(err instanceof Error ? err.message : 'Failed to recalculate game');
    } finally {
      setRecalcBusy(false);
    }
  };

  useEffect(() => {
    if (gameId) {
      fetchGame();
    }
  }, [gameId, fetchGame]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading game details...</div>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-600">{error || 'Game not found'}</div>
      </div>
    );
  }

  const isLive = rosters?.status === 'live';
  const isScheduled = rosters?.status === 'scheduled';
  const awayFinal = rosters?.away_score?.final;
  const homeFinal = rosters?.home_score?.final;
  const awayRuns = getAblRuns(awayFinal);
  const homeRuns = getAblRuns(homeFinal);
  const hasScores = isLive && rosters?.home_score && rosters?.away_score && awayRuns !== null && homeRuns !== null;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link href={`/${league}/${season}/games`} className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to Games
        </Link>
        {isAdmin && (
          <button
            onClick={recalculateGame}
            disabled={recalcBusy}
            className="bg-gray-900 text-white rounded px-3 py-2 text-sm disabled:bg-gray-400"
          >
            {recalcBusy ? 'Recalculating…' : 'Recalculate Result'}
          </button>
        )}
      </div>

      {recalcMessage && (
        <div className="mb-6 rounded bg-blue-50 text-blue-900 px-4 py-3 text-sm">
          {recalcMessage}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
        <div className="text-center mb-6">
          <p className="text-gray-600 mb-2">
            {new Date(game.gameDate).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          {game.description && (
            <p className="text-sm text-gray-500">{game.description}</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-8 items-center mb-8">
          <div className="text-right">
            <h2 className="text-3xl font-bold text-gray-900">
              {game.awayTeam.location} {game.awayTeam.nickname}
            </h2>
            {hasScores && (
              <p className="text-5xl font-bold text-blue-600 mt-2">{awayRuns!.toFixed(1)}</p>
            )}
          </div>

          <div className="text-center">
            <div className="text-4xl font-bold text-gray-400">@</div>
            {isLive && rosters?.result?.winner && rosters.result.isFinal !== false && (
              <p className="text-sm text-green-600 font-semibold mt-2">FINAL</p>
            )}
            {isLive && rosters?.result?.winner && rosters.result.isFinal === false && (
              <p className="text-sm text-yellow-600 font-semibold mt-2">IN PROGRESS</p>
            )}
          </div>

          <div className="text-left">
            <h2 className="text-3xl font-bold text-gray-900">
              {game.homeTeam.location} {game.homeTeam.nickname}
            </h2>
            {hasScores && (
              <p className="text-5xl font-bold text-blue-600 mt-2">{homeRuns!.toFixed(1)}</p>
            )}
          </div>
        </div>

        {hasScores && (
          <div className="grid grid-cols-2 gap-4 text-center border-t pt-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-2">Away Team Stats</h3>
              <div className="text-sm text-gray-700">
                <div>AB: {getFinalStat(awayFinal, 'ab')} | H: {getFinalStat(awayFinal, 'h')}</div>
                <div>HR: {getFinalStat(awayFinal, 'hr')} | E: {getFinalStat(awayFinal, 'e')}</div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-2">Home Team Stats</h3>
              <div className="text-sm text-gray-700">
                <div>AB: {getFinalStat(homeFinal, 'ab')} | H: {getFinalStat(homeFinal, 'h')}</div>
                <div>HR: {getFinalStat(homeFinal, 'hr')} | E: {getFinalStat(homeFinal, 'e')}</div>
              </div>
            </div>
          </div>
        )}

        {!isLive && (
          <div className="text-center py-4 bg-gray-50 rounded-lg">
            <p className="text-gray-500 text-sm">{isScheduled ? 'Scheduled — rosters below reflect current lineups' : 'Game not yet played'}</p>
          </div>
        )}
      </div>

      {(isLive || isScheduled) && rosters && (
        <div className="grid md:grid-cols-2 gap-8">
          <RosterCard
            title={`${game.awayTeam.nickname} ${isScheduled ? 'Current Lineup' : 'Lineup'}`}
            players={rosters.awayTeam}
            isProjected={isScheduled}
            teamStatusMap={teamStatusMap}
          />
          <RosterCard
            title={`${game.homeTeam.nickname} ${isScheduled ? 'Current Lineup' : 'Lineup'}`}
            players={rosters.homeTeam}
            isProjected={isScheduled}
            teamStatusMap={teamStatusMap}
          />
        </div>
      )}

      {isLive && rosters && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setShowDetails(v => !v)}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
        </div>
      )}

      {isLive && showDetails && rosters && (
        <div className="mt-6 space-y-8">
          <StatDetailTable
            title={`${game.awayTeam.nickname} — Stat Detail`}
            players={rosters.awayTeam}
          />
          <StatDetailTable
            title={`${game.homeTeam.nickname} — Stat Detail`}
            players={rosters.homeTeam}
          />
        </div>
      )}
    </div>
  );
}

const STAT_COLS: { key: keyof PlayerStats; label: string }[] = [
  { key: 'ab',  label: 'AB' },
  { key: 'h',   label: 'H' },
  { key: '2b',  label: '2B' },
  { key: '3b',  label: '3B' },
  { key: 'hr',  label: 'HR' },
  { key: 'bb',  label: 'BB' },
  { key: 'hbp', label: 'HBP' },
  { key: 'sb',  label: 'SB' },
  { key: 'cs',  label: 'CS' },
  { key: 'sac', label: 'SAC' },
  { key: 'sf',  label: 'SF' },
  { key: 'e',   label: 'E' },
  { key: 'pb',  label: 'PB' },
  { key: 'abl_points', label: 'Pts' },
];

const STARTER_PLAYED_TYPE = 'STARTER';
const SUB_PLAYED_TYPE = 'SUB';

function calcStatTotals(activePlayers: Player[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const col of STAT_COLS) {
    result[col.key] = activePlayers.reduce((sum, p) => sum + ((p.dailyStats?.[col.key] as number) || 0), 0);
  }
  return result;
}

function isRegulationPlayer(player: Player): boolean {
  return (
    player.ablPlayedType === STARTER_PLAYED_TYPE ||
    player.ablPlayedType === SUB_PLAYED_TYPE ||
    // Legacy rows may be missing ablPlayedType; treat non-XTRA played slots as regulation.
    (!player.ablPlayedType && player.playedPosition !== 'XTRA')
  );
}

function StatDetailTable({ title, players }: { title: string; players: Player[] }) {
  const sorted = [...players].sort((a, b) => (a.rosterOrder ?? 999) - (b.rosterOrder ?? 999));

  // Totals only over players who counted (have a playedPosition)
  const qualifying = sorted.filter(p => p.playedPosition);
  const regulationOnlyQualifying = qualifying.filter(isRegulationPlayer);
  const totals = calcStatTotals(qualifying);
  const regulationTotals = calcStatTotals(regulationOnlyQualifying);

  return (
    <div className="bg-white rounded-lg shadow-md p-4 overflow-x-auto">
      <h3 className="text-lg font-bold text-gray-900 mb-3">{title}</h3>
      <table className="w-full text-xs border-collapse min-w-[700px]">
        <thead>
          <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide">
            <th className="text-right py-2 px-1 font-semibold w-8">#</th>
            <th className="text-left py-2 px-2 font-semibold w-36">Player</th>
            <th className="text-left py-2 px-1 font-semibold w-12">Roster</th>
            <th className="text-left py-2 px-1 font-semibold w-12">Played</th>
            {STAT_COLS.map(c => (
              <th key={c.key} className={`text-right py-2 px-1 font-semibold ${c.key === 'abl_points' ? 'text-blue-600' : ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => {
            const s = p.dailyStats || {};
            const isSynth = p.name === 'supp' || p.name === 'four';
            const inGame = !!p.playedPosition;
            const rowCls = isSynth
              ? 'border-t text-gray-400 italic'
              : inGame
                ? 'border-t text-gray-900 bg-green-50'
                : 'border-t text-gray-400';
            return (
              <tr key={p._id ?? p.name} className={rowCls}>
                <td className="text-right py-1.5 px-1 text-gray-400">{isSynth ? '' : (p.rosterOrder ?? '')}</td>
                <td className="py-1.5 px-2 font-medium">
                  {p.name}
                  {!isSynth && (p.mlbTeam || p.lineupPosition) && (
                    <span className="ml-1 text-[10px] font-bold text-gray-400">
                      {p.mlbTeam}
                      {p.lineupPosition ? ` (${p.lineupPosition})` : ''}
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-1 text-gray-500">{p.lineupPosition}</td>
                <td className={`py-1.5 px-1 font-medium ${inGame ? 'text-green-700' : 'text-gray-300'}`}>{p.playedPosition || '—'}</td>
                {STAT_COLS.map(c => {
                  const val = (s[c.key] as number) || 0;
                  const dimmed = !inGame && !isSynth;
                  const highlight = dimmed
                    ? 'text-gray-300'
                    : c.key === 'abl_points' ? 'text-blue-600 font-semibold' : val > 0 ? 'text-gray-900' : 'text-gray-300';
                  return (
                    <td key={c.key} className={`text-right py-1.5 px-1 ${highlight}`}>
                      {c.key === 'abl_points' ? val.toFixed(1) : val || '—'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 font-semibold bg-gray-50 text-gray-700">
            <td className="py-2 px-1" />
            <th className="py-2 px-2" colSpan={3} scope="row">Total (regulation)</th>
            {STAT_COLS.map(c => (
              <td key={c.key} className={`text-right py-2 px-1 ${c.key === 'abl_points' ? 'text-blue-600' : ''}`}>
                {c.key === 'abl_points' ? regulationTotals[c.key].toFixed(1) : regulationTotals[c.key] || '—'}
              </td>
            ))}
          </tr>
          <tr className="border-t border-gray-200 font-semibold bg-gray-50 text-gray-700">
            <td className="py-2 px-1" />
            <th className="py-2 px-2" colSpan={3} scope="row">Total (final)</th>
            {STAT_COLS.map(c => (
              <td key={c.key} className={`text-right py-2 px-1 ${c.key === 'abl_points' ? 'text-blue-600' : ''}`}>
                {c.key === 'abl_points' ? totals[c.key].toFixed(1) : totals[c.key] || '—'}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function statLine(s: PlayerStats): string {
  const parts: string[] = [`${s.h ?? 0}-${s.ab ?? 0}`];
  const add = (val: number | undefined, label: string) => {
    if (!val) return;
    parts.push(val === 1 ? label : `${val}${label}`);
  };
  add(s['2b'], '2B'); add(s['3b'], '3B'); add(s.hr, 'HR');
  add(s.bb, 'BB'); add(s.hbp, 'HBP'); add(s.sb, 'SB');
  add(s.cs, 'CS'); add(s.sac, 'SAC'); add(s.sf, 'SF');
  add(s.po, 'PO'); add(s.e, 'E');
  return parts.join(', ');
}

function mlbGameBadge(status: MlbGameStatus | undefined, teamAbbr: string): string | null {
  if (!status) return null;
  const { state, inning, inningState, awayRuns, homeRuns, awayTeam } = status;
  if (state === 'Preview') return null;
  const score = awayRuns !== null && homeRuns !== null
    ? (teamAbbr === awayTeam ? `${awayRuns}-${homeRuns}` : `${homeRuns}-${awayRuns}`)
    : null;
  if (state === 'Final') return score ? `Final ${score}` : 'Final';
  const half = inningState === 'Top' ? 'T' : inningState === 'Bottom' ? 'B' : inningState === 'Middle' ? 'M' : inningState === 'End' ? 'E' : '';
  const inn = inning ? `${half}${inning}` : '';
  return [inn, score].filter(Boolean).join(' · ');
}

function RosterCard({ title, players, isProjected, teamStatusMap }: { title: string; players: Player[]; isProjected?: boolean; teamStatusMap: TeamStatusMap }) {
  const sortedPlayers = [...players].sort((a, b) => (a.lineupOrder || 999) - (b.lineupOrder || 999));

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-xl font-bold text-gray-900 mb-4">{title}</h3>
      <div className="space-y-2">
        {sortedPlayers.map((player, idx) => {
          const isInactive = !isProjected && !player.playedPosition;
          const posLabel = isProjected
            ? (player.lineupPosition || player.position || '—')
            : (player.playedPosition || 'Inactive');
          const mlbStatus = player.mlbTeam ? teamStatusMap.get(player.mlbTeam) : undefined;
          const badge = player.mlbTeam ? mlbGameBadge(mlbStatus, player.mlbTeam) : null;
          const badgeColor = !mlbStatus || mlbStatus.state === 'Preview' ? ''
            : mlbStatus.state === 'Final' ? 'text-gray-500'
            : 'text-emerald-600 font-medium';
          return (
            <div
              key={player._id}
              className={`flex items-center justify-between text-sm border-b pb-2 ${
                isInactive ? 'text-gray-400 bg-gray-50 rounded px-2 py-1' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`font-mono w-6 ${isInactive ? 'text-gray-400' : 'text-gray-500'}`}>{idx + 1}</span>
                <div>
                  <div className={`font-semibold ${isInactive ? 'text-gray-400' : ''}`}>
                    {player.name}
                    {(player.mlbTeam || player.lineupPosition) && (
                      <span className="ml-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide">
                        {player.mlbTeam}
                        {player.lineupPosition ? ` (${player.lineupPosition})` : ''}
                      </span>
                    )}
                  </div>
                  <div className={`text-xs ${isInactive ? 'text-gray-400' : 'text-gray-500'}`}>
                    {posLabel}
                    {player.eligible && player.eligible.length > 0 && (
                      <span className="ml-1 text-[10px] text-gray-400">
                        ({player.eligible.join(', ')})
                      </span>
                    )}
                    {!isProjected && player.ablPlayedType && (
                      <span className={`ml-1 px-1 rounded text-[10px] font-semibold uppercase tracking-wide ${
                        player.ablPlayedType === 'STARTER' ? 'bg-green-100 text-green-700' :
                        player.ablPlayedType === 'SUB'     ? 'bg-yellow-100 text-yellow-700' :
                        'bg-purple-100 text-purple-700'
                      }`}>{player.ablPlayedType === 'SUB' ? 'Supp' : player.ablPlayedType === 'STARTER' ? 'Starter' : 'Xtra'}</span>
                    )}
                    {badge && (
                      <span className={`ml-2 text-[10px] ${badgeColor}`}>{badge}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                {player.dailyStats && (
                  <div className={`text-xs ${isInactive ? 'text-gray-400' : 'text-gray-600'}`}>
                    <div>{statLine(player.dailyStats)}</div>
                    <div className={`font-semibold ${isInactive ? 'text-gray-400' : 'text-blue-600'}`}>
                      {player.dailyStats.abl_points?.toFixed(1)} pts
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {sortedPlayers.length === 0 && <p className="text-gray-500 text-center py-4">No players</p>}
    </div>
  );
}
