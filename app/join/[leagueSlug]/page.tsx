'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface SessionUser {
  sub: string;
  name: string;
  email?: string;
  picture?: string;
}

interface League {
  _id: string;
  name: string;
  slug: string;
  description?: string;
}

type PageState =
  | 'loading'
  | 'unauthenticated'
  | 'already_registered'
  | 'form'
  | 'success'
  | 'league_not_found'
  | 'no_active_season';

export default function JoinLeaguePage() {
  const { leagueSlug } = useParams<{ leagueSlug: string }>();
  const router = useRouter();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [existingTeam, setExistingTeam] = useState<{ nickname: string; location: string } | null>(
    null
  );

  // form fields
  const [nickname, setNickname] = useState('');
  const [location, setLocation] = useState('');
  const [stadium, setStadium] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [redirectTo, setRedirectTo] = useState('');

  useEffect(() => {
    const init = async () => {
      // Load league info + user in parallel
      const [meRes, leagueRes] = await Promise.all([
        fetch('/api/auth/me').then((r) => r.json()).catch(() => ({ user: null })),
        fetch(`/api/leagues/${leagueSlug}`).then((r) => r.json()).catch(() => null),
      ]);

      if (!leagueRes || leagueRes.error) {
        setPageState('league_not_found');
        return;
      }
      setLeague(leagueRes);

      if (!meRes.user) {
        setPageState('unauthenticated');
        return;
      }
      setUser(meRes.user);
      setPageState('form');
    };
    init();
  }, [leagueSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      const res = await fetch(`/api/join/${leagueSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, location, stadium }),
      });
      const data = await res.json();

      if (res.status === 409 && data.error === 'already_registered') {
        setExistingTeam(data.team);
        setPageState('already_registered');
        return;
      }

      if (!res.ok) {
        setFormError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      setRedirectTo(data.redirectTo ?? `/${leagueSlug}`);
      setPageState('success');
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const loginHref = `/api/auth/login?returnTo=${encodeURIComponent(`/join/${leagueSlug}`)}`;

  // --- Render states ---

  if (pageState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (pageState === 'league_not_found') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center space-y-3">
          <p className="text-3xl">🤔</p>
          <h1 className="text-xl font-bold text-gray-900">League Not Found</h1>
          <p className="text-gray-500 text-sm">
            The league <span className="font-mono font-medium">{leagueSlug}</span> doesn't exist.
            Double-check your invite link.
          </p>
        </div>
      </div>
    );
  }

  if (pageState === 'unauthenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center space-y-6">
          <div>
            <p className="text-4xl mb-3">⚾</p>
            <h1 className="text-2xl font-bold text-gray-900">
              Join {league?.name ?? leagueSlug}
            </h1>
            {league?.description && (
              <p className="text-gray-500 text-sm mt-1">{league.description}</p>
            )}
          </div>

          <p className="text-gray-600 text-sm">
            Sign in to create your team and compete in the {league?.name ?? leagueSlug}.
          </p>

          <a
            href={loginHref}
            className="block w-full rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors text-center"
          >
            Sign in to Join
          </a>

          <p className="text-xs text-gray-400">
            New to the app? Signing in will create your account automatically.
          </p>
        </div>
      </div>
    );
  }

  if (pageState === 'already_registered') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center space-y-6">
          <p className="text-4xl">✅</p>
          <h1 className="text-2xl font-bold text-gray-900">You're already in!</h1>
          <p className="text-gray-600 text-sm">
            Your team{' '}
            <strong>
              {existingTeam?.location} {existingTeam?.nickname}
            </strong>{' '}
            is already registered in {league?.name ?? leagueSlug}.
          </p>
          <a
            href={`/${leagueSlug}`}
            className="block w-full rounded-xl bg-green-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-green-700 transition-colors text-center"
          >
            Go to {league?.name ?? leagueSlug} →
          </a>
        </div>
      </div>
    );
  }

  if (pageState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center space-y-6">
          <p className="text-4xl">🎉</p>
          <h1 className="text-2xl font-bold text-gray-900">Welcome to {league?.name}!</h1>
          <p className="text-gray-600 text-sm">
            Your team{' '}
            <strong>
              {location} {nickname}
            </strong>{' '}
            has been created. Time to build your roster!
          </p>
          <button
            onClick={() => router.push(redirectTo)}
            className="block w-full rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors text-center"
          >
            Enter {league?.name} →
          </button>
        </div>
      </div>
    );
  }

  // form state
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <p className="text-4xl">⚾</p>
          <h1 className="text-2xl font-bold text-gray-900">
            Join {league?.name ?? leagueSlug}
          </h1>
          {league?.description && (
            <p className="text-gray-500 text-sm">{league.description}</p>
          )}
          <p className="text-gray-500 text-sm">
            Signed in as <span className="font-medium text-gray-700">{user?.name}</span>
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Create Your Team</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Choose a team name that will be yours all season.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                City / Location
              </label>
              <input
                type="text"
                required
                maxLength={40}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Springfield"
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                Team Nickname
              </label>
              <input
                type="text"
                required
                maxLength={40}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="e.g. Atoms"
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {location && nickname && (
                <p className="text-xs text-gray-400">
                  Your team: <span className="font-medium text-gray-600">{location} {nickname}</span>
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                Stadium Name
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={stadium}
                onChange={(e) => setStadium(e.target.value)}
                placeholder="e.g. Atom Field"
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Creating your team…' : `Join ${league?.name ?? leagueSlug}`}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400">
          Not {user?.name}?{' '}
          <a href="/api/auth/logout" className="underline hover:text-gray-600">
            Sign out
          </a>
        </p>
      </div>
    </div>
  );
}
