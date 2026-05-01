'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLeagueSeason } from '@/app/lib/league-season-context';

const POSITIONS = ['1B', '2B', '3B', 'SS', 'OF', 'C', 'DH'] as const;
type Position = typeof POSITIONS[number];

interface AblTeam {
  _id: string;
  nickname: string;
  location: string;
}

interface LeaderPlayer {
  _id: string;
  name: string;
  team: string;
  mlbID: number;
  abl: number;
  pa: number;
  ablTeam: AblTeam | null;
}

type Leaders = Record<Position, LeaderPlayer[]>;

export default function LeadersPage() {
  const ctx = useLeagueSeason();
  const { league, season } = ctx;

  const [leaders, setLeaders] = useState<Leaders | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLeaders() {
      try {
        const res = await fetch(`/api/leaders?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`);
        if (!res.ok) throw new Error('Failed to fetch leaders');
        const data = await res.json();
        setLeaders(data.leaders);
      } catch (err) {
        setError('Failed to load leaders');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaders();
  }, [league, season]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-gray-500">Loading leaders…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-full px-3 py-6 md:px-4 md:py-8">
      <div className="mb-6 md:mb-8">
        <Link
          href={`/${league}/${season}`}
          className="text-blue-600 hover:text-blue-800 mb-3 md:mb-4 inline-block text-sm md:text-base"
        >
          ← Back to Home
        </Link>
        <h1 className="text-2xl md:text-4xl font-bold text-gray-900">ABL Leaders</h1>
        <p className="text-sm text-gray-500 mt-1">
          Top 10 per position ranked by ABL score · Minimum qualifier: 2 PA per team game played
        </p>
      </div>

      {leaders && (
        <div className="space-y-8">
          {POSITIONS.map((pos) => (
            <PositionTable
              key={pos}
              position={pos}
              players={leaders[pos]}
              league={league}
              season={season}
            />
          ))}
        </div>
      )}

      <div className="mt-8 text-sm text-gray-500">
        <p>
          <strong>ABL Score:</strong> (H×25 + 2B×10 + 3B×20 + HR×30 + BB×10 + HBP×10 + SB×7 − CS×7 + SAC×5) / AB − 4.5
        </p>
      </div>
    </div>
  );
}

function PositionTable({
  position,
  players,
  league,
  season,
}: {
  position: Position;
  players: LeaderPlayer[];
  league: string;
  season: string;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2">
        <span className="inline-block bg-blue-600 text-white text-xs font-semibold px-2 py-0.5 rounded">
          {position}
        </span>
      </h2>

      {players.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No qualified players yet.</p>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="block md:hidden space-y-2">
            {players.map((player, i) => (
              <div
                key={player._id}
                className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-3"
              >
                <span className="text-xs text-gray-400 w-5 shrink-0">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900 truncate">{player.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {player.team}
                    {player.ablTeam && (
                      <> · <Link
                        href={`/${league}/${season}/teams/${player.ablTeam._id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {player.ablTeam.location} {player.ablTeam.nickname}
                      </Link></>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-gray-900">
                    {player.abl.toFixed(3)}
                  </div>
                  <div className="text-xs text-gray-400">{player.pa} PA</div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">
                    #
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Player
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    MLB Team
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ABL Team
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ABL Score
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PA
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {players.map((player, i) => (
                  <tr key={player._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {player.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {player.team}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {player.ablTeam ? (
                        <Link
                          href={`/${league}/${season}/teams/${player.ablTeam._id}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {player.ablTeam.location} {player.ablTeam.nickname}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold text-gray-900">
                      {player.abl.toFixed(3)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-center text-gray-600">
                      {player.pa}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
