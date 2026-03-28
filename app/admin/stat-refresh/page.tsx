'use client';

import { useState } from 'react';
import Link from 'next/link';

interface StatRefreshResponse {
  ok: boolean;
  targetDate?: string;
  dateRange?: { start: string; end: string };
  daysProcessed?: number;
  recalculate?: boolean;
  refreshSummary?: {
    scheduledGames?: number;
    playersUpdated?: number;
    statlinesUpdated?: number;
  };
  recalcSummary?: {
    totalGames?: number;
    processed?: number;
    skipped?: number;
    errors?: number;
  } | null;
  error?: string;
}

export default function StatRefreshPage() {
  const [singleDate, setSingleDate] = useState('');
  const [recalc, setRecalc] = useState(true);
  const [singleBusy, setSingleBusy] = useState(false);
  const [singleResult, setSingleResult] = useState<StatRefreshResponse | null>(null);

  const [bulkStart, setBulkStart] = useState('');
  const [bulkEnd, setBulkEnd] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<StatRefreshResponse | null>(null);

  const [error, setError] = useState<string | null>(null);

  const runSingle = async () => {
    setSingleBusy(true);
    setSingleResult(null);
    setError(null);
    try {
      const payload: Record<string, unknown> = { recalculate: recalc };
      if (singleDate) payload.date = singleDate;
      const res = await fetch('/api/jobs/daily-stat-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: StatRefreshResponse = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Stat refresh failed');
      setSingleResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stat refresh failed');
    } finally {
      setSingleBusy(false);
    }
  };

  const runBulk = async () => {
    if (!bulkStart || !bulkEnd) {
      setError('Both start and end dates are required');
      return;
    }
    setBulkBusy(true);
    setBulkResult(null);
    setError(null);
    try {
      const res = await fetch('/api/jobs/daily-stat-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateStart: bulkStart, dateEnd: bulkEnd, recalculate: recalc }),
      });
      const data: StatRefreshResponse = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Bulk refresh failed');
      setBulkResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk refresh failed');
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">MLB Stat Download</h1>
        <p className="text-gray-500 text-sm mt-1">
          Pull MLB boxscore data into player and statline collections, then optionally recalculate ABL game results.
          The nightly cron also runs this job automatically.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Single date */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Single Date</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Leave date blank to use the previous UTC day (what the nightly cron uses).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={singleDate}
            onChange={(e) => setSingleDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={recalc}
              onChange={(e) => setRecalc(e.target.checked)}
              className="rounded"
            />
            Recalculate ABL games
          </label>
          <button
            onClick={runSingle}
            disabled={singleBusy}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {singleBusy ? 'Downloading…' : 'Run Download'}
          </button>
        </div>
        {singleResult?.ok && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900 space-y-1">
            <div className="font-medium">Completed for {singleResult.targetDate}</div>
            <div>
              Scheduled games {singleResult.refreshSummary?.scheduledGames ?? 0} &bull;{' '}
              Players updated {singleResult.refreshSummary?.playersUpdated ?? 0} &bull;{' '}
              Statlines updated {singleResult.refreshSummary?.statlinesUpdated ?? 0}
            </div>
            {singleResult.recalculate !== false && singleResult.recalcSummary && (
              <div className="text-emerald-700">
                Recalc: total {singleResult.recalcSummary.totalGames ?? 0}, processed{' '}
                {singleResult.recalcSummary.processed ?? 0}, skipped {singleResult.recalcSummary.skipped ?? 0},{' '}
                errors {singleResult.recalcSummary.errors ?? 0}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bulk date range */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Bulk Date Range</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Download and process stats for an entire range — use for season-wide backfills.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={bulkStart}
            onChange={(e) => setBulkStart(e.target.value)}
            placeholder="Start date"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={bulkEnd}
            onChange={(e) => setBulkEnd(e.target.value)}
            placeholder="End date"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={recalc}
              onChange={(e) => setRecalc(e.target.checked)}
              className="rounded"
            />
            Recalculate ABL games
          </label>
          <button
            onClick={runBulk}
            disabled={bulkBusy}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {bulkBusy ? 'Refreshing…' : 'Run Bulk Refresh'}
          </button>
        </div>
        {bulkResult?.ok && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900 space-y-1">
            <div className="font-medium">
              Completed — {bulkResult.daysProcessed} days processed ({bulkResult.dateRange?.start} to{' '}
              {bulkResult.dateRange?.end})
            </div>
            <div>
              Scheduled games {bulkResult.refreshSummary?.scheduledGames ?? 0} &bull;{' '}
              Players updated {bulkResult.refreshSummary?.playersUpdated ?? 0} &bull;{' '}
              Statlines updated {bulkResult.refreshSummary?.statlinesUpdated ?? 0}
            </div>
            {bulkResult.recalculate !== false && bulkResult.recalcSummary && (
              <div className="text-emerald-700">
                Recalc: processed {bulkResult.recalcSummary.processed ?? 0}, skipped{' '}
                {bulkResult.recalcSummary.skipped ?? 0}, errors {bulkResult.recalcSummary.errors ?? 0}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
