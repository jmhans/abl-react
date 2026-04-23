'use client';

import { useEffect, useRef, useState } from 'react';

type PosEntry = { pos: string; ct: number };
type PosLogData = { positionsLog: PosEntry[]; eligiblePositions: string[]; abl: number | null };

const THRESHOLD = 10;
// Module-level cache — persists for the lifetime of the page, cleared on full navigation
const posLogCache = new Map<string, PosLogData | null>();

export function PosLogPopover({ mlbId }: { mlbId?: string | number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PosLogData | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!mlbId) return;
    const key = String(mlbId);
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (posLogCache.has(key)) {
      setData(posLogCache.get(key) ?? null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/players/${key}/position-log`);
      if (res.ok) {
        const json: PosLogData = await res.json();
        posLogCache.set(key, json);
        setData(json);
      } else {
        posLogCache.set(key, null);
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!mlbId) return null;

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={toggle}
        className="ml-1 inline-flex items-center text-gray-400 hover:text-blue-500 leading-none focus:outline-none"
        title="View 2026 position log"
        aria-label="View position log"
        aria-expanded={open}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
          <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 1-1.061-1.061 3 3 0 1 1 2.871 5.026v.345a.75.75 0 0 1-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 1 0 8.94 6.94ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-50 w-48 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div className="text-xs font-semibold text-gray-700 mb-2">2026 Position Log</div>
          {loading ? (
            <div className="text-xs text-gray-400">Loading…</div>
          ) : !data || data.positionsLog.length === 0 ? (
            <div className="text-xs text-gray-400">No data yet</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th className="text-left font-normal pb-1">Pos</th>
                  <th className="text-right font-normal pb-1 pr-2">G</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.positionsLog.map(({ pos, ct }) => {
                  const eligible = ct >= THRESHOLD;
                  const needed = THRESHOLD - ct;
                  return (
                    <tr key={pos}>
                      <td className="pr-2 font-medium text-gray-700">{pos}</td>
                      <td className="pr-2 text-right tabular-nums text-gray-600">{ct}</td>
                      <td className="whitespace-nowrap">
                        {eligible
                          ? <span className="text-green-600 font-semibold">✓</span>
                          : <span className="text-gray-400">+{needed}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="mt-2 border-t border-gray-100 pt-1 text-xs text-gray-400">≥{THRESHOLD}g = eligible</div>
          {data && data.abl !== null && (
            <div className="mt-1 text-xs">
              <span className="text-gray-400">ABL Score: </span>
              <span className="font-semibold text-blue-600 tabular-nums">{data.abl.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
