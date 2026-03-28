'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTeams() {
      try {
        const response = await fetch('/api/teams');
        if (!response.ok) {
          throw new Error('Failed to fetch teams');
        }
        const data = await response.json();
        setTeams(data);
      } catch (err) {
        setError('Failed to load teams');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchTeams();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading teams...</div>
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
      <div className="mb-8">
        <Link href="/" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to Home
        </Link>
        <h1 className="text-4xl font-bold text-gray-900">ABL Teams</h1>
        <p className="text-gray-600 mt-2">{teams.length} teams in the league</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {teams.map((team) => (
          <div
            key={team._id}
            className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow border-l-4 border-blue-500"
          >
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {team.location && <span className="text-gray-600">{team.location} </span>}
              {team.nickname}
            </h2>
            
            {team.stadium && (
              <p className="text-sm text-gray-500 mb-4">
                🏟️ {team.stadium}
              </p>
            )}

            {team.owners && team.owners.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Owners:</h3>
                <div className="space-y-1">
                  {team.owners.map((owner, idx) => (
                    <div key={idx} className="text-sm text-gray-600">
                      {owner.name || owner.email || 'Unknown'}
                      {owner.verified && (
                        <span className="ml-2 text-green-600">✓</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-200">
              <Link
                href={`/teams/${team._id}/roster`}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                View Roster →
              </Link>
            </div>
          </div>
        ))}
      </div>

      {teams.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500 text-lg">No teams found</p>
        </div>
      )}
    </div>
  );
}
