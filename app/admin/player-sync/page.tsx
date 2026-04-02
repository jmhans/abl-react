'use client';

import { useState } from 'react';
import Link from 'next/link';

type SyncResult = {
  ok: boolean;
  sources?: {
    fromRosters?: number;
    fromSpringMlb?: number;
    fromRegularMlb?: number;
    fromAAA?: number;
  };
  playerOpsTotal?: number;
  playersUpserted?: number;
  posLogUpserted?: number;
  errors?: string[];
  error?: string;
};

export default function PlayerSyncPage() {
  const [busy, setBusy] = useState(false);
  const [withAAA, setWithAAA] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const url = `/api/players/sync-batting${withAAA ? '?withAAA=1' : ''}`;
      const res = await fetch(url, { method: 'POST' });
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
          &larr; Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Expand Player Pool</h1>
        <p className="text-gray-500 text-sm mt-1">
          Seeds the player list from multiple sources so position players show up even before
          they have regular-season boxscore data. Run this before the draft.
        </p>
      </div>

      <div className="rounded-xl bg-white shadow-sm border border-gray-100 p-6 space-y-5">
        <div className="space-y-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">Sources (always included):</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>
              <span className="font-medium text-gray-800">40-man non-pitchers</span> from the
              last roster sync &mdash; captures injured and IL players with no stats yet
            </li>
            <li>
              <span className="font-medium text-gray-800">MLB spring training batting stats</span>
              &mdash; any position player who had an AB in spring, including prospects on
              spring rosters who are not yet on a 40-man
            </li>
            <li>
              <span className="font-medium text-gray-800">MLB regular-season batting stats</span>
              &mdash; players with ABs in early regular-season games
            </li>
          </ul>

          <div className="pt-2 border-t border-gray-100">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={withAAA}
                onChange={(e) => setWithAAA(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="font-medium text-gray-800">Also include AAA spring training</span>
                <span className="block text-gray-500 text-xs mt-0.5">
                  Pulls in top prospects and players on rehab assignments who played in
                  Triple-A spring games. Good for deep leagues / keeper leagues.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="pt-2">
          <p className="text-xs text-gray-400 mb-3">
            Position eligibility is seeded from roster/spring position (using $setOnInsert) so
            real season data from{' '}
            <code className="bg-gray-100 px-1 rounded">update-positions-2026.mjs</code> always
            takes priority.
          </p>
          <button
            onClick={run}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Syncing...' : 'Expand Player Pool'}
          </button>
        </div>

        {result?.ok && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-900 space-y-2">
            <div className="font-medium">Done</div>
            <div className="space-y-1 text-green-800">
              {result.sources && (
                <>
                  <div>40-man roster non-pitchers: {result.sources.fromRosters ?? 0}</div>
                  <div>MLB spring training: {result.sources.fromSpringMlb ?? 0}</div>
                  <div>MLB regular season: {result.sources.fromRegularMlb ?? 0}</div>
                  {result.sources.fromAAA !== undefined && (
                    <div>AAA spring training: {result.sources.fromAAA}</div>
                  )}
                </>
              )}
              <div className="pt-1 border-t border-green-200 font-medium">
                Players upserted: {result.playersUpserted} &bull; position_log seeded:{' '}
                {result.posLogUpserted}
              </div>
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="text-amber-700 mt-1">
                Partial errors:
                <ul className="list-disc list-inside mt-1">
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
            {result.error ?? 'Sync failed'}
          </div>
        )}
      </div>
    </div>
  );
}
