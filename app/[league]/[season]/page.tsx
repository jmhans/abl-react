'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLeagueSeason } from '@/app/lib/league-season-context';

interface User {
  name?: string;
  email?: string;
  picture?: string;
}

export default function LeagueSeasonHome() {
  const { league, season } = useLeagueSeason();
  const base = `/${league}/${season}`;

  const [user, setUser] = useState<User | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [seasonStatus, setSeasonStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [userRes, draftCheck, seasonRes] = await Promise.all([
          fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/games?league=${league}&season=${season}&gameType=D&limit=1&view=summary`)
            .then(r => r.json()).catch(() => []),
          fetch(`/api/seasons?league=${league}&year=${season}`).then(r => r.json()).catch(() => []),
        ]);
        setUser(userRes?.user || null);
        setHasDraft(Array.isArray(draftCheck) && draftCheck.length > 0);
        const s = Array.isArray(seasonRes) ? seasonRes[0] : null;
        setSeasonStatus(s?.status ?? null);
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [league, season]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-gray-500">Loading…</div>
      </div>
    );
  }

  const leagueName = league.toUpperCase();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">
          {leagueName} — {season} Season
        </h1>
        {user ? (
          <p className="text-gray-500 text-sm">Welcome back, {user.name || user.email}!</p>
        ) : (
          <p className="text-gray-500 text-sm">
            <a href="/api/auth/login" className="text-blue-600 hover:text-blue-800">Sign in</a>{' '}
            to access your personalized dashboard.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href={`${base}/standings`} className="bg-white p-5 rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow transition group">
          <div className="text-2xl mb-2">📈</div>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">Standings</h2>
          <p className="text-xs text-gray-500 mt-1">{season} league standings and stats</p>
        </Link>

        <Link href={`${base}/games`} className="bg-white p-5 rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow transition group">
          <div className="text-2xl mb-2">⚾</div>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">Scores</h2>
          <p className="text-xs text-gray-500 mt-1">Game schedule and results</p>
        </Link>

        <Link href={`${base}/teams`} className="bg-white p-5 rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow transition group">
          <div className="text-2xl mb-2">🏟️</div>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">Teams</h2>
          <p className="text-xs text-gray-500 mt-1">Browse all {leagueName} teams</p>
        </Link>

        {(hasDraft || seasonStatus === 'pre-draft') && (
          <Link href={`${base}/draft`} className="bg-white p-5 rounded-lg border border-gray-200 hover:border-teal-400 hover:shadow transition group">
            <div className="text-2xl mb-2">🎯</div>
            <h2 className="text-sm font-semibold text-gray-900 group-hover:text-teal-700">Draft Room</h2>
            <p className="text-xs text-gray-500 mt-1">{seasonStatus === 'pre-draft' && !hasDraft ? 'Draft coming soon — check the board' : '24-round grouped snake draft board'}</p>
          </Link>
        )}
      </div>
    </div>
  );
}
