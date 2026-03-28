'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface League {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt?: string;
}

interface Season {
  _id: string;
  leagueId: string;
  year: number;
  slug: string;
  status: string;
  teamIds: string[];
}

export default function AdminLeaguesPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);

  // form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true);
    const [leaguesRes, seasonsRes] = await Promise.all([
      fetch('/api/leagues').then((r) => r.json()),
      fetch('/api/seasons').then((r) => r.json()),
    ]);
    setLeagues(Array.isArray(leaguesRes) ? leaguesRes : []);
    setSeasons(Array.isArray(seasonsRes) ? seasonsRes : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Auto-generate slug from name
  const handleNameChange = (val: string) => {
    setName(val);
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const res = await fetch('/api/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, description }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create league');
      } else {
        setSuccess(`League "${data.name}" created!`);
        setName('');
        setSlug('');
        setDescription('');
        load();
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const seasonCountFor = (leagueId: string) =>
    seasons.filter((s) => s.leagueId?.toString() === leagueId.toString()).length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-10">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">League Management</h1>
        <p className="text-gray-500 text-sm mt-1">View all leagues and create new ones.</p>
      </div>

      {/* Existing leagues */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">Existing Leagues</h2>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : leagues.length === 0 ? (
          <p className="text-sm text-gray-400">No leagues yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {leagues.map((league) => (
              <div key={league._id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="font-semibold text-gray-900">{league.name}</p>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">/{league.slug}</p>
                  {league.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{league.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-sm text-gray-500">
                    {seasonCountFor(league._id)}{' '}
                    {seasonCountFor(league._id) === 1 ? 'season' : 'seasons'}
                  </span>
                  <Link
                    href="/admin/seasons"
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Manage seasons →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create new league */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">Create New League</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">League Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. ABL"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Slug</label>
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. abl"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400">Used in URLs: /{slug || 'slug'}/2026/…</p>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}

          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Creating…' : 'Create League'}
          </button>
        </form>
      </section>
    </div>
  );
}
