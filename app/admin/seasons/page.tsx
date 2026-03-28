'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface League {
  _id: string;
  name: string;
  slug: string;
}

interface Season {
  _id: string;
  leagueId: string;
  year: number;
  slug: string;
  status: string;
  isActive: boolean;
  teamIds: string[];
}

export default function AdminSeasonsPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);

  // form state
  const [leagueSlug, setLeagueSlug] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true);
    const [leaguesRes, seasonsRes] = await Promise.all([
      fetch('/api/leagues').then((r) => r.json()),
      fetch('/api/seasons').then((r) => r.json()),
    ]);
    const leagueList: League[] = Array.isArray(leaguesRes) ? leaguesRes : [];
    setLeagues(leagueList);
    setSeasons(Array.isArray(seasonsRes) ? seasonsRes : []);
    if (leagueList.length && !leagueSlug) setLeagueSlug(leagueList[0].slug);
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const res = await fetch('/api/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueSlug, year: Number(year), teamIds: [] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create season');
      } else {
        const leagueName = leagues.find((l) => l.slug === leagueSlug)?.name ?? leagueSlug;
        setSuccess(`Season ${data.year} created for ${leagueName}! Add teams on the season detail page.`);
        setYear(String(new Date().getFullYear()));
        load();
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const leagueFor = (leagueId: string) =>
    leagues.find((l) => l._id.toString() === leagueId.toString());

  // Group seasons by league id
  const grouped: Record<string, Season[]> = {};
  for (const s of seasons) {
    const key = s.leagueId?.toString() ?? 'unknown';
    (grouped[key] ??= []).push(s);
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-10">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Season Management</h1>
        <p className="text-gray-500 text-sm mt-1">
          Create seasons and manage team assignments.
        </p>
      </div>

      {/* Existing seasons grouped by league */}
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-gray-800">Existing Seasons</h2>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : Object.keys(grouped).length === 0 ? (
          <p className="text-sm text-gray-400">No seasons yet.</p>
        ) : (
          Object.entries(grouped).map(([leagueId, leagueSeasons]) => {
            const league = leagueFor(leagueId);
            return (
              <div key={leagueId} className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                  {league ? `${league.name} (/${league.slug})` : leagueId}
                </h3>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  {leagueSeasons
                    .sort((a, b) => b.year - a.year)
                    .map((season) => (
                      <div
                        key={season._id}
                        className="flex items-center justify-between px-5 py-4"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-gray-900">{season.year}</span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              season.isActive
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {season.isActive ? 'Active' : season.status ?? 'inactive'}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <span>{season.teamIds?.length ?? 0} teams</span>
                          <Link
                            href={`/admin/seasons/${season._id}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            Manage teams →
                          </Link>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Create new season */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">Create New Season</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">League</label>
              {leagues.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No leagues found.{' '}
                  <Link href="/admin/leagues" className="text-blue-600 hover:underline">
                    Create one first.
                  </Link>
                </p>
              ) : (
                <select
                  required
                  value={leagueSlug}
                  onChange={(e) => setLeagueSlug(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {leagues.map((l) => (
                    <option key={l._id} value={l.slug}>
                      {l.name} ({l.slug})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Year</label>
              <input
                type="number"
                required
                min={2020}
                max={2100}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}

          <button
            type="submit"
            disabled={saving || leagues.length === 0}
            className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Creating…' : 'Create Season'}
          </button>
        </form>
      </section>
    </div>
  );
}
