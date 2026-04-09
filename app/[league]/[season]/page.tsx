'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLeagueSeason } from '@/app/lib/league-season-context';

interface User {
  name?: string;
  email?: string;
  picture?: string;
}

interface AdminResponse {
  isAdmin?: boolean;
}

export default function LeagueSeasonHome() {
  const { league, season } = useLeagueSeason();
  const base = `/${league}/${season}`;

  const [user, setUser] = useState<User | null>(null);
  const [draftActive, setDraftActive] = useState(false);
  const [draftCompleted, setDraftCompleted] = useState(false);
  const [seasonStatus, setSeasonStatus] = useState<string | null>(null);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [userRes, adminRes, draftCheck, seasonRes, myLeaguesRes] = await Promise.all([
          fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/admin/me').then(r => r.ok ? r.json() : {} as AdminResponse).catch(() => ({} as AdminResponse)),
          fetch(`/api/draft?league=${league}&season=${season}`, { cache: 'no-store' })
            .then(r => r.ok ? r.json() : { draft: null }).catch(() => ({ draft: null })),
          fetch(`/api/seasons?league=${league}&year=${season}`).then(r => r.json()).catch(() => []),
          fetch('/api/auth/my-leagues').then(r => r.json()).catch(() => []),
        ]);
        
        const sessionUser = userRes?.user || null;
        setUser(sessionUser);
        setIsAdmin(adminRes?.isAdmin ?? false);
        setDraftActive(draftCheck?.draft?.status === 'active');
        setDraftCompleted(draftCheck?.draft?.status === 'completed');
        const s = Array.isArray(seasonRes) ? seasonRes[0] : null;
        setSeasonStatus(s?.status ?? null);

        // Find user's team in current league/season
        if (sessionUser?.sub) {
          const currentEntry = (Array.isArray(myLeaguesRes) ? myLeaguesRes : []).find(
            (e: any) => e.league?.slug === league && String(e.season?.year) === String(season)
          );
          if (currentEntry?.team?._id) {
            setUserTeamId(currentEntry.team._id);
          }
        }
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
          <p className="text-gray-500 text-sm">Welcome back, {user.name || 'ABL User'}!</p>
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
          <div className="text-2xl mb-2">📅</div>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">Scores</h2>
          <p className="text-xs text-gray-500 mt-1">Game schedule and results</p>
        </Link>

        <Link href={`${base}/teams`} className="bg-white p-5 rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow transition group">
          <div className="text-2xl mb-2">👥</div>
          <h2 className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">Teams</h2>
          <p className="text-xs text-gray-500 mt-1">Browse all {leagueName} teams</p>
        </Link>

        {(draftActive || draftCompleted) && (
          <Link href={`${base}/draft`} className={`bg-white p-5 rounded-lg border hover:shadow transition group ${
            draftActive ? 'border-teal-300 hover:border-teal-500' : 'border-gray-200 hover:border-gray-400'
          }`}>
            <div className="text-2xl mb-2">🎯</div>
            <h2 className="text-sm font-semibold text-gray-900 group-hover:text-teal-700">Draft Room</h2>
            <p className={`text-xs mt-1 ${draftActive ? 'text-teal-600' : 'text-gray-500'}`}>
              {draftActive ? 'Draft is live — make your picks!' : 'View draft summary'}
            </p>
          </Link>
        )}

        {userTeamId && (
          <Link href={`${base}/teams/${userTeamId}/roster`} className="bg-white p-5 rounded-lg border border-gray-200 hover:border-purple-400 hover:shadow transition group">
            <div className="text-2xl mb-2">🏢</div>
            <h2 className="text-sm font-semibold text-gray-900 group-hover:text-purple-700">My Team</h2>
            <p className="text-xs text-gray-500 mt-1">Your roster, lineups, and settings</p>
          </Link>
        )}

        {userTeamId && (
          <Link href={`${base}/teams/${userTeamId}/free-agents`} className="bg-white p-5 rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow transition group">
            <div className="text-2xl mb-2">👤</div>
            <h2 className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">Free Agents</h2>
            <p className="text-xs text-gray-500 mt-1">Add and manage pickups</p>
          </Link>
        )}

        {isAdmin && (
          <Link href={`/admin?league=${league}&season=${season}`} className="bg-white p-5 rounded-lg border border-gray-200 hover:border-red-400 hover:shadow transition group">
            <div className="text-2xl mb-2">⚙️</div>
            <h2 className="text-sm font-semibold text-gray-900 group-hover:text-red-700">Admin</h2>
            <p className="text-xs text-gray-500 mt-1">League and season management</p>
          </Link>
        )}
      </div>
    </div>
  );
}
