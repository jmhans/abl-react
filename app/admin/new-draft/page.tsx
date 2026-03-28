'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DraftTeam, getTeamDisplayName } from '@/app/lib/draft-utils';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function NewDraftPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [order, setOrder] = useState<DraftTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingDraft, setExistingDraft] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsRes, draftRes] = await Promise.all([
        fetch('/api/teams'),
        fetch('/api/draft', { cache: 'no-store' }),
      ]);

      if (!teamsRes.ok) throw new Error('Failed to load teams');

      const teamsData: DraftTeam[] = await teamsRes.json();
      const draftData = draftRes.ok ? await draftRes.json() : { draft: null };

      setTeams(teamsData);
      setOrder(shuffle(teamsData));
      setExistingDraft(draftData.draft?.status === 'active');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const move = (index: number, delta: -1 | 1) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  const handleStartDraft = async () => {
    if (existingDraft) {
      const confirmed = confirm(
        'There is already an active draft. Starting a new draft will clear all rosters and abandon the current draft. Continue?',
      );
      if (!confirmed) return;
    }

    setStarting(true);
    setError(null);

    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: order.map((t) => t._id) }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to start draft');
      }

      router.push('/draft');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start draft');
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xl text-gray-600">
        Loading teams…
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Draft Setup</h1>
        <p className="text-gray-600 mt-1">
          Set the pick order for Round 1. The draft uses a snake format, so round 2 reverses this
          order, and so on.
        </p>
      </div>

      {existingDraft && (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠ An active draft already exists. Starting a new draft will abandon it and clear all rosters.
        </div>
      )}

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Pick order card */}
      <div className="rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">Round 1 Pick Order</h2>
          <button
            type="button"
            onClick={() => setOrder(shuffle(teams))}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            🔀 Re-randomize
          </button>
        </div>

        <ol className="divide-y">
          {order.map((team, index) => (
            <li
              key={team._id}
              className="flex items-center gap-3 px-5 py-3"
            >
              <span className="w-7 text-right text-sm font-semibold text-gray-400">
                {index + 1}.
              </span>
              <span className="flex-1 text-gray-900 font-medium">
                {getTeamDisplayName(team)}
              </span>
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move up"
                  className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === order.length - 1}
                  aria-label="Move down"
                  className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ▼
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Start button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleStartDraft}
          disabled={starting || order.length === 0}
          className="rounded-lg bg-green-600 px-6 py-3 text-base font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {starting ? 'Starting Draft…' : '▶ Start Draft'}
        </button>
      </div>
    </div>
  );
}
