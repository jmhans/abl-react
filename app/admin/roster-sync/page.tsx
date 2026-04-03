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
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<{
    ok: boolean;
    players?: number;
    ms?: number;
    error?: string;
  } | null>(null);

  const rebuildCache = async () => {
    setRebuildBusy(true);
    setRebuildResult(null);
    try {
      const res = await fetch('/api/players/refresh-cache', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setRebuildResult(data);
    } catch {
      setRebuildResult({ ok: false, error: 'Network error' });
    } finally {
      setRebuildBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setResult(null);
    setRebuildResult(null);
    try {
      const res = await fetch('/api/players/sync-rosters', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setResult(data);
      if (data.ok) {
        // Automatically rebuild the player cache so draft page reflects updated statuses
        await rebuildCache();
      }
    } catch {
      setResult({ ok: false, error: 'Network error' });
    } finally {
      setBusy(false);
    }
  };

  const isBusy = busy || rebuildBusy;

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
          The player cache is rebuilt automatically afterwards (~25s).
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={run}
            disabled={isBusy}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Syncing Rosters…' : rebuildBusy ? 'Rebuilding Player Cache…' : 'Sync Rosters + Rebuild Cache'}
          </button>
          <button
            onClick={rebuildCache}
            disabled={isBusy}
            className="rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {rebuildBusy ? 'Rebuilding…' : 'Rebuild Player Cache Only'}
          </button>
        </div>

        {result?.ok && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-900 space-y-1">
            <div className="font-medium">Roster sync complete</div>
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

        {rebuildBusy && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
            Rebuilding player cache… this takes about 25 seconds.
          </div>
        )}

        {rebuildResult?.ok && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-900">
            <div className="font-medium">Player cache rebuilt</div>
            <div>{rebuildResult.players} players materialized in {((rebuildResult.ms ?? 0) / 1000).toFixed(1)}s. Draft page will now load in &lt;1s.</div>
          </div>
        )}

        {result && !result.ok && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            Roster sync failed: {result.error || 'Unknown error'}
          </div>
        )}

        {rebuildResult && !rebuildResult.ok && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            Cache rebuild failed: {rebuildResult.error || 'Unknown error'}
          </div>
        )}
      </div>
    </div>
  );
}
