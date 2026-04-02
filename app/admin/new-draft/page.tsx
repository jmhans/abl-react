'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
  const searchParams = useSearchParams();
  const league = searchParams.get('league') ?? '';
  const season = searchParams.get('season') ?? '';
  const leagueQuery = league && season ? `?league=${league}&season=${season}` : '';
  const backHref = `/admin${leagueQuery}`;
  const draftHref = league && season ? `/${league}/${season}/draft` : '/draft';
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [order, setOrder] = useState<DraftTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingDraft, setExistingDraft] = useState<{ status: string; picksCount: number } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsRes, draftRes] = await Promise.all([
        fetch(league && season ? `/api/teams?league=${league}&season=${season}` : '/api/teams'),
        fetch(league && season ? `/api/draft?league=${league}&season=${season}` : '/api/draft', { cache: 'no-store' }),
      ]);

      if (!teamsRes.ok) throw new Error('Failed to load teams');

      const teamsData: DraftTeam[] = await teamsRes.json();
      const draftData = draftRes.ok ? await draftRes.json() : { draft: null };

      setTeams(teamsData);
      setOrder(shuffle(teamsData));
      const d = draftData.draft;
      setExistingDraft(d ? { status: d.status, picksCount: (d.picks || []).length } : null);
      setShowSetup(!d); // auto-open setup only if no draft exists
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

  const handleDeleteDraft = async () => {
    const confirmed = confirm(
      `This will permanently delete the ${existingDraft?.status} draft (${existingDraft?.picksCount} pick${existingDraft?.picksCount !== 1 ? 's' : ''}) and clear all lineups. This cannot be undone. Continue?`,
    );
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(league && season ? `/api/draft?league=${league}&season=${season}` : '/api/draft', {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete draft');
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete draft');
    } finally {
      setDeleting(false);
    }
  };

  const handleStartDraft = async () => {
    if (existingDraft) {
      const confirmed = confirm(
        `There is already a ${existingDraft.status} draft. Starting a new draft will abandon it and clear all rosters. Continue?`,
      );
      if (!confirmed) return;
    }

    setStarting(true);
    setError(null);

    try {
      const res = await fetch(league && season ? `/api/draft?league=${league}&season=${season}` : '/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: order.map((t) => t._id) }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to start draft');
      }

      router.push(draftHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start draft');
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xl text-gray-600">
        Loadingâ€¦
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-800 border-green-200',
    completed: 'bg-blue-100 text-blue-800 border-blue-200',
    abandoned: 'bg-gray-100 text-gray-600 border-gray-200',
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <Link href={backHref} className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          â† Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Draft Management</h1>
        {league && season && (
          <p className="text-sm text-gray-500 mt-0.5">{league.toUpperCase()} {season}</p>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Existing draft card */}
      {existingDraft ? (
        <div className="rounded-xl bg-white shadow border border-gray-100 divide-y">
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Current Draft</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase ${statusColors[existingDraft.status] ?? 'bg-gray-100 text-gray-700'}`}>
                  {existingDraft.status}
                </span>
                <span className="text-sm text-gray-700">
                  {existingDraft.picksCount} pick{existingDraft.picksCount !== 1 ? 's' : ''} made
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(existingDraft.status === 'active' || existingDraft.status === 'completed') && (
                <Link
                  href={draftHref}
                  className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  View Draft â†’
                </Link>
              )}
              <button
                type="button"
                onClick={handleDeleteDraft}
                disabled={deleting}
                className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {deleting ? 'Deletingâ€¦' : 'ðŸ—‘ Delete'}
              </button>
            </div>
          </div>
          <div className="px-5 py-3">
            <button
              type="button"
              onClick={() => setShowSetup((v) => !v)}
              className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
            >
              {showSetup ? 'â–² Hide new draft setup' : 'â–¼ Start a new draft insteadâ€¦'}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-4 text-sm text-gray-500">
          No draft found for this league/season. Use the form below to create one.
        </div>
      )}

      {/* New draft setup â€” shown automatically when no draft, or toggled when one exists */}
      {showSetup && (
        <>
          <div className="rounded-lg bg-white shadow">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="font-semibold text-gray-900">Round 1 Pick Order</h2>
                <p className="text-xs text-gray-500 mt-0.5">Snake format â€” round 2 reverses this order, and so on.</p>
              </div>
              <button
                type="button"
                onClick={() => setOrder(shuffle(teams))}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                ðŸ”€ Re-randomize
              </button>
            </div>

            <ol className="divide-y">
              {order.map((team, index) => (
                <li key={team._id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-7 text-right text-sm font-semibold text-gray-400">{index + 1}.</span>
                  <span className="flex-1 text-gray-900 font-medium">{getTeamDisplayName(team)}</span>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label="Move up"
                      className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >â–²</button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === order.length - 1}
                      aria-label="Move down"
                      className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >â–¼</button>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleStartDraft}
              disabled={starting || order.length === 0}
              className="rounded-lg bg-green-600 px-6 py-3 text-base font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {starting ? 'Starting Draftâ€¦' : 'â–¶ Start Draft'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

