'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface LeagueEntry {
  team: { _id: string; nickname: string; location: string } | null;
  season: { _id: string; year: number; slug: string; status?: string };
  league: { _id: string; name: string; slug: string } | null;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  active:    { label: 'Active',    className: 'bg-green-100 text-green-700' },
  'pre-draft': { label: 'Pre-Draft', className: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Completed', className: 'bg-gray-100 text-gray-500' },
};

export default function MySeasonsPage() {
  const [entries, setEntries] = useState<LeagueEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/my-leagues')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          // Sort: non-completed first, then by year desc
          const sorted = [...data].sort((a, b) => {
            const aCompleted = a.season?.status === 'completed' ? 1 : 0;
            const bCompleted = b.season?.status === 'completed' ? 1 : 0;
            if (aCompleted !== bCompleted) return aCompleted - bCompleted;
            return (b.season?.year ?? 0) - (a.season?.year ?? 0);
          });
          setEntries(sorted);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const teamName = (entry: LeagueEntry) =>
    entry.team ? `${entry.team.location} ${entry.team.nickname}` : '—';

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Seasons</h1>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-400 text-sm">No league seasons found.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            if (!entry.league) return null;
            const href = `/${entry.league.slug}/${entry.season.year}`;
            const status = entry.season.status ?? 'active';
            const badge = STATUS_LABEL[status] ?? { label: status, className: 'bg-gray-100 text-gray-500' };
            return (
              <Link
                key={entry.season._id}
                href={href}
                className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4 hover:bg-gray-50 transition-colors shadow-sm"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    {entry.league.name} {entry.season.year}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{teamName(entry)}</p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badge.className}`}>
                  {badge.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
