'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLeagueSeason } from '@/app/lib/league-season-context';

interface Team {
  _id: string;
  nickname: string;
  location?: string;
  stadium?: string;
  userId?: string;
  owners?: Array<{
    userId?: string;
    name?: string;
    email?: string;
    verified?: boolean;
  }>;
}

export default function TeamDetailPage() {
  const params = useParams();
  const teamId = params.id as string;
  const { league, season } = useLeagueSeason();

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTeam() {
      try {
        const response = await fetch(`/api/teams/${teamId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch team');
        }
        const data = await response.json();
        setTeam(data);
      } catch (err) {
        setError('Failed to load team details');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    if (teamId) {
      fetchTeam();
    }
  }, [teamId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading team details...</div>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-600">{error || 'Team not found'}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Link href={`/${league}/${season}/teams`} className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to Teams
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
        <div className="border-b border-gray-200 pb-6 mb-6">
          <h1 className="text-4xl font-bold text-gray-900">
            {team.location && <span className="text-gray-600">{team.location} </span>}
            {team.nickname}
          </h1>

          {team.stadium && (
            <p className="text-lg text-gray-600 mt-2">🏟️ {team.stadium}</p>
          )}
        </div>

        {team.owners && team.owners.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Team Owners</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {team.owners.map((owner, idx) => (
                <div key={idx} className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{owner.name || 'Unknown Owner'}</p>
                      {owner.email && <p className="text-sm text-gray-600">{owner.email}</p>}
                    </div>
                    {owner.verified && <span className="text-green-600 text-xl">✓</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-4">
          <Link
            href={`/${league}/${season}/teams/${team._id}/roster`}
            className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition font-medium"
          >
            View Roster
          </Link>
          <Link
            href={`/${league}/${season}/teams/${team._id}/free-agents`}
            className="inline-block bg-gray-200 text-gray-800 px-6 py-2 rounded-lg hover:bg-gray-300 transition font-medium"
          >
            Free Agents
          </Link>
        </div>
      </div>
    </div>
  );
}
