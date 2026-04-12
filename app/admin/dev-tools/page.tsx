'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface LogLine {
  msg: string;
  type: 'log' | 'error' | 'done';
}

type RunState = 'idle' | 'running' | 'done' | 'error';

export default function DevToolsPage() {
  const [runState, setRunState] = useState<RunState>('idle');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll as logs arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const startSync = async () => {
    if (runState === 'running') return;

    setLogs([]);
    setRunState('running');

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch('/api/admin/sync-prod-to-dev', {
        method: 'POST',
        signal: abort.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        setLogs([{ msg: `❌ Request failed (${res.status}): ${text}`, type: 'error' }]);
        setRunState('error');
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          try {
            const parsed: LogLine = JSON.parse(part.slice(6));
            if (parsed.type === 'done') {
              setRunState(prev => prev === 'running' ? 'done' : prev);
            } else {
              setLogs(prev => [...prev, parsed]);
              if (parsed.type === 'error') setRunState('error');
            }
          } catch {
            // malformed SSE line — ignore
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setLogs(prev => [
        ...prev,
        { msg: `❌ Network error: ${err instanceof Error ? err.message : String(err)}`, type: 'error' },
      ]);
      setRunState('error');
    } finally {
      abortRef.current = null;
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setLogs([]);
    setRunState('idle');
  };

  const isRunning = runState === 'running';

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dev Tools</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Local / preview environment utilities. These tools are intentionally blocked on production.
        </p>
      </div>

      {/* Sync section */}
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center shrink-0 text-lg">
              🗄️
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Refresh DB from Prod</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Copies every collection from <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">heroku_wm40bx9r</code> (prod) into{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">abl_dev</code> (dev). Each collection is
                dropped then repopulated. Views are skipped.{' '}
                <span className="font-medium text-amber-700 dark:text-amber-400">One-way only — never modifies prod data.</span>
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={startSync}
              disabled={isRunning}
              className="rounded-lg bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-5 py-2.5 text-sm font-medium transition-colors"
            >
              {isRunning ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Syncing…
                </span>
              ) : (
                '⬇️  Pull from Prod'
              )}
            </button>

            {(runState !== 'idle') && (
              <button
                onClick={reset}
                disabled={isRunning}
                className="rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 px-4 py-2.5 text-sm font-medium transition-colors"
              >
                Reset
              </button>
            )}

            {runState === 'done' && (
              <span className="text-sm text-green-700 dark:text-green-400 font-medium">✅ Sync complete</span>
            )}
            {runState === 'error' && (
              <span className="text-sm text-red-700 dark:text-red-400 font-medium">❌ Sync failed — see log below</span>
            )}
          </div>

          {/* Log output */}
          {logs.length > 0 && (
            <div className="rounded-lg bg-gray-950 border border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
                <span className="text-xs font-mono text-gray-400 uppercase tracking-widest">Output</span>
                {isRunning && (
                  <span className="flex items-center gap-1.5 text-xs text-amber-400">
                    <span className="inline-block w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                    Running
                  </span>
                )}
              </div>
              <div className="p-4 h-80 overflow-y-auto font-mono text-xs leading-relaxed space-y-0.5">
                {logs.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.type === 'error'
                        ? 'text-red-400'
                        : line.msg.startsWith('✅') || line.msg.startsWith('  ✓')
                        ? 'text-green-400'
                        : line.msg.startsWith('❌')
                        ? 'text-red-400'
                        : line.msg.startsWith('ℹ️')
                        ? 'text-blue-400'
                        : 'text-gray-300'
                    }
                  >
                    {line.msg || '\u00A0'}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
