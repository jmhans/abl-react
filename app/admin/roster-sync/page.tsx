'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function RosterSyncPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    teamsProcessed?: number;
    teamsUpdated?: number;
    playersFound?: number;
    errors?: string[];
    error?: string;
  } | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/players/sync-rosters', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setResult(data);
    } catch {
      setResult({ ok: false, error: 'Network error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Sync Roster Statuses</h1>
        <p className="text-gray-500 text-sm mt-1">
          Fetches each team's 40-man roster from the MLB Stats API and updates each player's{' '}
          <code className="bg-gray-100 px-1 rounded text-xs">status</code> field (Active, 10-Day IL, 60-Day IL, Minors, etc.).
          Run this before creating a draft so the player list can be filtered to active roster players only.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <button
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Syncing Rosters…' : 'Sync Roster Statuses'}
        </button>

        {result?.ok && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-900 space-y-1">
            <div className="font-medium">Sync complete</div>
            <div>
              {result.teamsUpdated}/{result.teamsProcessed} teams synced &bull;{' '}
              {result.playersFound} players on 40-man rosters
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="text-amber-700">
                {result.errors.length} team error{result.errors.length !== 1 ? 's' : ''}:
                <ul className="mt-1 list-disc list-inside">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {result && !result.ok && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {result.error || 'Sync failed'}
          </div>
        )}
      </div>
    </div>
  );
}
