'use client';

import { useState, useEffect, useCallback } from 'react';
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
  liveSplitsSummary?: {
    playersScanned?: number;
    playersPersisted?: number;
    error?: string;
  };
  error?: string;
}

interface LiveSplitsRefreshResponse {
  ok: boolean;
  league?: string;
  season?: string;
  liveSplitsSummary?: {
    playersScanned?: number;
    playersPersisted?: number;
  };
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

  const [splitsLeague, setSplitsLeague] = useState('abl');
  const [splitsSeason, setSplitsSeason] = useState('active');
  const [splitsBusy, setSplitsBusy] = useState(false);
  const [splitsResult, setSplitsResult] = useState<LiveSplitsRefreshResponse | null>(null);

  const [coverage, setCoverage] = useState<{
    lastDate: string | null;
    missingDates: string[];
    coveredCount: number;
    yesterday: string;
  } | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const res = await fetch('/api/jobs/stat-coverage');
      if (res.ok) setCoverage(await res.json());
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  useEffect(() => { loadCoverage(); }, [loadCoverage]);

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
      await loadCoverage();
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
      await loadCoverage();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk refresh failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const runLiveSplitsRefresh = async () => {
    setSplitsBusy(true);
    setSplitsResult(null);
    setError(null);
    try {
      const res = await fetch('/api/jobs/live-splits-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league: splitsLeague, season: splitsSeason }),
      });
      const data: LiveSplitsRefreshResponse = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Live splits refresh failed');
      setSplitsResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Live splits refresh failed');
    } finally {
      setSplitsBusy(false);
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

      {/* Coverage summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Coverage</h2>
          <button
            onClick={loadCoverage}
            disabled={coverageLoading}
            className="text-xs text-emerald-700 hover:text-emerald-900 disabled:text-gray-400"
          >
            {coverageLoading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
        {coverageLoading && !coverage ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : coverage ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-gray-500">Last downloaded:</span>{' '}
                <span className="font-medium text-gray-900">
                  {coverage.lastDate ?? <span className="text-gray-400">none</span>}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Covered since 2026-03-26:</span>{' '}
                <span className="font-medium text-gray-900">{coverage.coveredCount} days</span>
              </div>
              <div>
                <span className="text-gray-500">Missing through {coverage.yesterday}:</span>{' '}
                <span className={`font-medium ${
                  coverage.missingDates.length === 0 ? 'text-emerald-700' : 'text-amber-700'
                }`}>
                  {coverage.missingDates.length === 0 ? 'none ✓' : `${coverage.missingDates.length} day${coverage.missingDates.length !== 1 ? 's' : ''}`}
                </span>
              </div>
            </div>
            {coverage.missingDates.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-xs font-semibold text-amber-800 mb-2">Missing dates:</p>
                <div className="flex flex-wrap gap-1.5">
                  {coverage.missingDates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSingleDate(d)}
                      className="rounded bg-amber-100 px-2 py-0.5 text-xs font-mono text-amber-900 hover:bg-amber-200 transition-colors"
                      title={`Click to populate single-date field`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-amber-600 mt-2">Click a date to pre-fill the single-date field below.</p>
              </div>
            )}
          </div>
        ) : null}
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
            <div className="font-medium">Stats downloaded for {singleResult.targetDate}</div>
            <div>
              {singleResult.refreshSummary?.scheduledGames ?? 0} MLB games &bull;{' '}
              {singleResult.refreshSummary?.playersUpdated ?? 0} players updated &bull;{' '}
              {singleResult.refreshSummary?.statlinesUpdated ?? 0} stat lines recorded
            </div>
            {singleResult.recalculate !== false && singleResult.recalcSummary && (
              <div className="text-emerald-700">
                Recalculated {singleResult.recalcSummary.processed ?? 0} of {singleResult.recalcSummary.totalGames ?? 0} ABL games
                {(singleResult.recalcSummary.skipped ?? 0) > 0 && ` (${singleResult.recalcSummary.skipped} skipped)`}
                {(singleResult.recalcSummary.errors ?? 0) > 0 && ` · ${singleResult.recalcSummary.errors} errors`}
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
              Downloaded stats for {bulkResult.daysProcessed} days ({bulkResult.dateRange?.start} – {bulkResult.dateRange?.end})
            </div>
            <div>
              {bulkResult.refreshSummary?.scheduledGames ?? 0} MLB games &bull;{' '}
              {bulkResult.refreshSummary?.playersUpdated ?? 0} players updated &bull;{' '}
              {bulkResult.refreshSummary?.statlinesUpdated ?? 0} stat lines recorded
            </div>
            {bulkResult.recalculate !== false && bulkResult.recalcSummary && (
              <div className="text-emerald-700">
                Recalculated {bulkResult.recalcSummary.processed ?? 0} ABL games
                {(bulkResult.recalcSummary.skipped ?? 0) > 0 && ` (${bulkResult.recalcSummary.skipped} skipped)`}
                {(bulkResult.recalcSummary.errors ?? 0) > 0 && ` · ${bulkResult.recalcSummary.errors} errors`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live splits refresh */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Live Splits Cache Refresh</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Rebuild persisted compact split snapshots only (player_splits_live) without re-running MLB downloads.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={splitsLeague}
            onChange={(e) => setSplitsLeague(e.target.value)}
            placeholder="league slug (e.g. abl)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <input
            type="text"
            value={splitsSeason}
            onChange={(e) => setSplitsSeason(e.target.value)}
            placeholder="season slug/year (e.g. active, 2026)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            onClick={runLiveSplitsRefresh}
            disabled={splitsBusy}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {splitsBusy ? 'Refreshing…' : 'Refresh Live Splits'}
          </button>
        </div>
        {splitsResult?.ok && (
          <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-3 text-sm text-indigo-900 space-y-1">
            <div className="font-medium">
              Live splits refreshed for {splitsResult.league} / {splitsResult.season}
            </div>
            <div>
              {splitsResult.liveSplitsSummary?.playersPersisted ?? 0} players persisted
              {' '}out of {splitsResult.liveSplitsSummary?.playersScanned ?? 0} scanned
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
