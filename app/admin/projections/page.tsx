'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const PROJ_SYSTEMS = ['Steamer', 'ZiPS', 'DepthCharts', 'ATC', 'THE BAT', 'THE BAT X', 'Other'];

type Summary = {
  _id: { season: number; projSystem: string };
  count: number;
  matched: number;
  lastImport: string;
};

type ImportResult = {
  ok: boolean;
  season?: number;
  projSystem?: string;
  rowsParsed?: number;
  skipped?: number;
  matched?: number;
  unmatched?: number;
  upserted?: number;
  error?: string;
};

export default function ProjectionsPage() {
  const [csvText, setCsvText] = useState('');
  const [season, setSeason] = useState('2026');
  const [projSystem, setProjSystem] = useState('Steamer');
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadSummary = async () => {
    const res = await fetch('/api/projections').catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSummary(data.summary ?? []);
    }
  };

  useEffect(() => { loadSummary(); }, []);

  const handleImport = async () => {
    if (!csvText.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ season, system: projSystem, ...(replace ? { replace: '1' } : {}) });
      const res = await fetch(`/api/projections/import?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: csvText,
      });
      const data = await res.json().catch(() => ({}));
      setResult(data);
      if (data.ok) {
        setCsvText('');
        loadSummary();
      }
    } catch {
      setResult({ ok: false, error: 'Network error' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (s: number, sys: string) => {
    const key = `${s}-${sys}`;
    if (!confirm(`Delete all ${sys} ${s} projections?`)) return;
    setDeleting(key);
    try {
      await fetch(`/api/projections?season=${s}&system=${encodeURIComponent(sys)}`, { method: 'DELETE' });
      loadSummary();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          &larr; Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Season Projections</h1>
        <p className="text-sm text-gray-500 mt-1">
          Import Fangraphs projection CSVs to show projected ABL scores on the draft page.
          Go to{' '}
          <a
            href="https://www.fangraphs.com/projections?pos=all&stats=bat&type=steamer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            fangraphs.com/projections
          </a>
          , set pos=all &amp; stats=bat, choose a projection system, then Export Data (CSV).
        </p>
      </div>

      {/* Existing projections */}
      {summary.length > 0 && (
        <div className="rounded-xl bg-white shadow-sm border border-gray-100 divide-y">
          <div className="px-5 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
            Imported projections
          </div>
          {summary.map((s) => {
            const key = `${s._id.season}-${s._id.projSystem}`;
            return (
              <div key={key} className="flex items-center justify-between px-5 py-3">
                <div>
                  <span className="font-medium text-gray-900">{s._id.projSystem}</span>
                  <span className="ml-2 text-sm text-gray-500">{s._id.season}</span>
                  <span className="ml-3 text-xs text-gray-400">
                    {s.count} players &bull; {s.matched} matched to MLB IDs
                  </span>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Imported {new Date(s.lastImport).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(s._id.season, s._id.projSystem)}
                  disabled={deleting === key}
                  className="rounded border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  {deleting === key ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Import form */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 p-6 space-y-5">
        <h2 className="font-semibold text-gray-900">Import CSV</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Projection System</label>
            <select
              value={projSystem}
              onChange={(e) => setProjSystem(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {PROJ_SYSTEMS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Season</label>
            <input
              type="number"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            CSV Data{' '}
            <span className="text-gray-400 font-normal">
              (paste all rows including header from Fangraphs export)
            </span>
          </label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={10}
            placeholder={'Name,Team,G,PA,AB,H,1B,2B,3B,HR,R,RBI,BB,IBB,SO,HBP,SF,SH,GDP,SB,CS,...,playerid'}
            className="w-full rounded border border-gray-300 px-3 py-2 text-xs font-mono resize-y"
          />
          <p className="text-xs text-gray-400 mt-1">
            Tip: Fangraphs sometimes exports an MLBAMID column for accurate player matching.
            If absent, matching falls back to player name.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
              className="rounded border-gray-300"
            />
            Replace existing {projSystem} {season} projections
          </label>
          <button
            type="button"
            onClick={handleImport}
            disabled={busy || !csvText.trim()}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {busy ? 'Importing...' : 'Import Projections'}
          </button>
        </div>

        {result?.ok && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-900 space-y-1">
            <div className="font-medium">Import complete &mdash; {result.projSystem} {result.season}</div>
            <div>
              {result.rowsParsed} rows parsed &bull; {result.skipped} skipped (no AB) &bull;{' '}
              {result.upserted} upserted
            </div>
            <div>
              MLB ID matched: <span className="font-medium">{result.matched}</span>{' '}
              &bull; unmatched (name fallback or missing): <span className="font-medium">{result.unmatched}</span>
            </div>
            {(result.unmatched ?? 0) > 50 && (
              <div className="text-amber-700 text-xs">
                High unmatched count usually means MLBAMID column is absent. Consider running
                Expand Player Pool first to populate more player names.
              </div>
            )}
          </div>
        )}

        {result && !result.ok && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {result.error ?? 'Import failed'}
          </div>
        )}
      </div>
    </div>
  );
}
