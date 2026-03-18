'use client';

import { useEffect, useState } from 'react';
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

export default function GameDetailPage() {
  const params = useParams();
  const gameId = params.id as string;

  const [game, setGame] = useState<Game | null>(null);
  const [rosters, setRosters] = useState<GameRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGame() {
      try {
        const [gameRes, rostersRes] = await Promise.all([
          fetch(`/api/games/${gameId}`),
          fetch(`/api/games/${gameId}/rosters`)
        ]);

        if (!gameRes.ok || !rostersRes.ok) {
          throw new Error('Failed to fetch game details');
        }

        const gameData = await gameRes.json();
        const rostersData = await rostersRes.json();

        setGame(gameData);
        setRosters(rostersData);
      } catch (err) {
        setError('Failed to load game details');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    if (gameId) {
      fetchGame();
    }
  }, [gameId]);

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
  const hasScores = isLive && rosters?.home_score && rosters?.away_score;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Link href="/games" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to Games
        </Link>
      </div>

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
                {rosters.away_score.final.abl_runs.toFixed(1)}
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
                {rosters.home_score.final.abl_runs.toFixed(1)}
              </p>
            )}
          </div>
        </div>

        {hasScores && (
          <div className="grid grid-cols-2 gap-4 text-center border-t pt-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-2">Away Team Stats</h3>
              <div className="text-sm text-gray-700">
                <div>AB: {rosters.away_score.final.ab} | H: {rosters.away_score.final.h}</div>
                <div>HR: {rosters.away_score.final.hr} | E: {rosters.away_score.final.e}</div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-2">Home Team Stats</h3>
              <div className="text-sm text-gray-700">
                <div>AB: {rosters.home_score.final.ab} | H: {rosters.home_score.final.h}</div>
                <div>HR: {rosters.home_score.final.hr} | E: {rosters.home_score.final.e}</div>
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
  const activePlayers = players.filter(p => p.dailyStats && p.dailyStats.g! > 0)
    .sort((a, b) => (a.lineupOrder || 999) - (b.lineupOrder || 999));

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-xl font-bold text-gray-900 mb-4">{title}</h3>
      <div className="space-y-2">
        {activePlayers.map((player, idx) => (
          <div key={player._id} className="flex items-center justify-between text-sm border-b pb-2">
            <div className="flex items-center gap-3">
              <span className="text-gray-500 font-mono w-6">{idx + 1}</span>
              <div>
                <div className="font-semibold">{player.name}</div>
                <div className="text-gray-500 text-xs">
                  {player.playedPosition} | {player.position}
                </div>
              </div>
            </div>
            <div className="text-right">
              {player.dailyStats && (
                <div className="text-xs text-gray-600">
                  {player.dailyStats.h}/{player.dailyStats.ab} 
                  {player.dailyStats.hr! > 0 && ` ${player.dailyStats.hr}HR`}
                  <div className="font-semibold text-blue-600">
                    {player.dailyStats.abl_points?.toFixed(1)} pts
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {activePlayers.length === 0 && (
        <p className="text-gray-500 text-center py-4">No active players</p>
      )}
    </div>
  );
}
