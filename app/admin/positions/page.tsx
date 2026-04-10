'use client';

import { useState } from 'react';
import Link from 'next/link';

type UpdateResult = {
  ok: boolean;
  season?: number;
  playersProcessed?: number;
  positionsUpserted?: number;
  posLogUpserted?: number;
  gamesForEligible?: number;
  message?: string;
  error?: string;
};

type SyncLogResult = {
  ok: boolean;
  season?: number;
  playersProcessed?: number;
  posLogUpserted?: number;
  gamesForEligible?: number;
  error?: string;
};

export default function PositionsPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [syncBusy, setSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncLogResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/players/update-positions', { method: 'POST' });
      const data: UpdateResult = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Position update failed');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Position update failed');
    } finally {
      setBusy(false);
    }
  };

  const syncLog = async () => {
    setSyncBusy(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch('/api/players/sync-position-log', { method: 'POST' });
      const data: SyncLogResult = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Position log sync failed');
      setSyncResult(data);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Position log sync failed');
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Update Player Positions</h1>
        <p className="text-gray-500 text-sm mt-1">
          Scans all regular-season statlines for {new Date().getFullYear()} and sets each
          player&apos;s default position to the position they&apos;ve played most. Also updates
          eligibility (≥&nbsp;10 games at a position earns a slot). Players with no current-season
          appearances fall back to last year&apos;s position automatically.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        <div className="space-y-2 text-sm text-gray-700">
          <p className="font-medium text-gray-900">What this does:</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Reads every statline document from {new Date().getFullYear()} Opening Day forward</li>
            <li>
              Counts games at each position per player (RF/CF/LF all count as OF; PH/PR/P are
              excluded)
            </li>
            <li>Sets <strong>CommishPos</strong> = most-played position in <code>positions</code> collection</li>
            <li>
              Updates <code>position_log</code> with <strong>maxPosition</strong> and{' '}
              <strong>eligiblePositions</strong> (≥&nbsp;10 games)
            </li>
            <li>
              Clears CommishPos for players with no {new Date().getFullYear()} appearances so
              the draft page falls back to last year&apos;s eligibility
            </li>
          </ul>
          <p className="text-xs text-gray-400 mt-2">
            After running, rebuild the player cache from the Roster Sync page to surface updated
            eligibility in the draft board.
          </p>
        </div>

        <button
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-teal-600 px-5 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Updating positions…' : 'Update Positions'}
        </button>

        {result?.ok && (
          <div className="rounded-lg bg-teal-50 border border-teal-200 px-4 py-3 text-sm text-teal-900 space-y-1">
            {result.message ? (
              <div>{result.message}</div>
            ) : (
              <>
                <div className="font-medium">✓ Positions updated for {result.season} season</div>
                <div>
                  {result.playersProcessed} players with appearances &bull;{' '}
                  {result.positionsUpserted} CommishPos records updated &bull;{' '}
                  {result.posLogUpserted} position_log records updated
                </div>
                <div className="text-teal-700">
                  Eligibility threshold: ≥&nbsp;{result.gamesForEligible} games at a position
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Sync Eligibility (position_log only)</h2>
          <p className="text-gray-500 text-sm mt-1">
            Updates <code>position_log</code> eligibility from current-season statlines and rebuilds
            the player cache. Does <strong>not</strong> touch CommishPos. This is the same step
            that runs automatically at the end of every daily stat refresh.
          </p>
        </div>

        {syncError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {syncError}
          </div>
        )}

        <button
          onClick={syncLog}
          disabled={syncBusy}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {syncBusy ? 'Syncing eligibility…' : 'Sync Position Log'}
        </button>

        {syncResult?.ok && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900 space-y-1">
            <div className="font-medium">✓ position_log synced for {syncResult.season} season</div>
            <div>
              {syncResult.playersProcessed} players processed &bull;{' '}
              {syncResult.posLogUpserted} position_log records updated
            </div>
            <div className="text-blue-700">
              Eligibility threshold: ≥&nbsp;{syncResult.gamesForEligible} games at a position
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
