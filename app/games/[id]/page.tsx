'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

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
  sb?: number;
  e?: number;
  abl_points?: number;
}

interface Player {
  _id: string;
  name: string;
  position?: string;
  dailyStats?: PlayerStats;
  playedPosition?: string;
  lineupOrder?: number;
}

interface GameRoster {
  homeTeam: Player[];
  awayTeam: Player[];
  home_score: { regulation: any; final: any };
  away_score: { regulation: any; final: any };
  result?: { winner: Team; loser: Team };
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

  const [game, setGame] = useState<Game | null>(null);
  const [rosters, setRosters] = useState<GameRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);

  const fetchGame = useCallback(async () => {
    try {
      const [gameRes, rostersRes, adminRes] = await Promise.all([
        fetch(`/api/games/${gameId}`),
        fetch(`/api/games/${gameId}/rosters`),
        fetch('/api/admin/me')
      ]);

      if (!gameRes.ok || !rostersRes.ok) {
        throw new Error('Failed to fetch game details');
      }

      const gameData = await gameRes.json();
      const rostersData = await rostersRes.json();

      if (adminRes.ok) {
        const adminData = await adminRes.json();
        setIsAdmin(Boolean(adminData?.isAdmin));
      }

      setGame(gameData);
      setRosters(rostersData);
    } catch (err) {
      setError('Failed to load game details');
      console.error(err);
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
  const awayFinal = rosters?.away_score?.final;
  const homeFinal = rosters?.home_score?.final;
  const awayRuns = getAblRuns(awayFinal);
  const homeRuns = getAblRuns(homeFinal);
  const hasScores = isLive && rosters?.home_score && rosters?.away_score && awayRuns !== null && homeRuns !== null;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link href="/games" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
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
              day: 'numeric' 
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
              <p className="text-5xl font-bold text-blue-600 mt-2">
                {awayRuns!.toFixed(1)}
              </p>
            )}
          </div>

          <div className="text-center">
            <div className="text-4xl font-bold text-gray-400">@</div>
            {isLive && rosters?.result?.winner && (
              <p className="text-sm text-green-600 font-semibold mt-2">FINAL</p>
            )}
          </div>

          <div className="text-left">
            <h2 className="text-3xl font-bold text-gray-900">
              {game.homeTeam.location} {game.homeTeam.nickname}
            </h2>
            {hasScores && (
              <p className="text-5xl font-bold text-blue-600 mt-2">
                {homeRuns!.toFixed(1)}
              </p>
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
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <p className="text-gray-500">Game not yet played</p>
          </div>
        )}
      </div>

      {isLive && rosters && (
        <div className="grid md:grid-cols-2 gap-8">
          <RosterCard
            title={`${game.awayTeam.nickname} Lineup`}
            players={rosters.awayTeam}
          />
          <RosterCard
            title={`${game.homeTeam.nickname} Lineup`}
            players={rosters.homeTeam}
          />
        </div>
      )}
    </div>
  );
}

function RosterCard({ title, players }: { title: string; players: Player[] }) {
  const sortedPlayers = [...players]
    .sort((a, b) => (a.lineupOrder || 999) - (b.lineupOrder || 999));

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-xl font-bold text-gray-900 mb-4">{title}</h3>
      <div className="space-y-2">
        {sortedPlayers.map((player, idx) => {
          const isInactive = !player.playedPosition;
          return (
          <div
            key={player._id}
            className={`flex items-center justify-between text-sm border-b pb-2 ${isInactive ? 'text-gray-400 bg-gray-50 rounded px-2 py-1' : ''}`}
          >
            <div className="flex items-center gap-3">
              <span className={`font-mono w-6 ${isInactive ? 'text-gray-400' : 'text-gray-500'}`}>{idx + 1}</span>
              <div>
                <div className={`font-semibold ${isInactive ? 'text-gray-400' : ''}`}>{player.name}</div>
                <div className={`text-xs ${isInactive ? 'text-gray-400' : 'text-gray-500'}`}>
                  {player.playedPosition || 'Inactive'} | {player.position}
                </div>
              </div>
            </div>
            <div className="text-right">
              {player.dailyStats && (
                <div className={`text-xs ${isInactive ? 'text-gray-400' : 'text-gray-600'}`}>
                  {player.dailyStats.h}/{player.dailyStats.ab} 
                  {player.dailyStats.hr! > 0 && ` ${player.dailyStats.hr}HR`}
                  <div className={`font-semibold ${isInactive ? 'text-gray-400' : 'text-blue-600'}`}>
                    {player.dailyStats.abl_points?.toFixed(1)} pts
                  </div>
                </div>
              )}
            </div>
          </div>
        )})}
      </div>
      {sortedPlayers.length === 0 && (
        <p className="text-gray-500 text-center py-4">No players</p>
      )}
    </div>
  );
}
