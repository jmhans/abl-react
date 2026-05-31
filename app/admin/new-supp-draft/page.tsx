'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getTeamDisplayName, getOwnerDisplay, DraftTeam } from '@/app/lib/draft-utils';
import { calculateSuppDraftRounds, MAX_DROP_INDICATIONS } from '@/app/lib/supp-draft-utils';

type OrderedTeam = DraftTeam & {
  w: number;
  l: number;
  g: number;
  ablRuns: number;
  avgAblRuns: number;
};

type ExistingSuppDraft = {
  _id: string;
  status: string;
  scheduledAt: string | null;
  rounds: number;
  picksCount: number;
  dropIndicationsCount: number;
  orderIds: string[];
};

export default function NewSuppDraftPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leagueParam = searchParams.get('league') ?? '';
  const seasonParam = searchParams.get('season') ?? '';

  // Resolved league/season — may be auto-detected from the active season when not in URL
  const [resolvedLeague, setResolvedLeague] = useState(leagueParam);
  const [resolvedSeason, setResolvedSeason] = useState(seasonParam);

  const league = resolvedLeague;
  const season = resolvedSeason;
  const leagueQuery = league && season ? `?league=${league}&season=${season}` : '';
  const backHref = `/admin${leagueQuery}`;
  const suppDraftHref = league && season ? `/${league}/${season}/supp-draft` : null;

  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingDraft, setExistingDraft] = useState<ExistingSuppDraft | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [newScheduledAt, setNewScheduledAt] = useState('');
  // Start-draft flow: fetch fresh order, let admin reorder, then lock
  const [preparingToStart, setPreparingToStart] = useState(false);
  const [startOrder, setStartOrder] = useState<OrderedTeam[]>([]);
  const [loadingStartOrder, setLoadingStartOrder] = useState(false);
  // Reorder active draft flow
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderList, setReorderList] = useState<DraftTeam[]>([]);
  const [loadingReorderList, setLoadingReorderList] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Auto-detect active league/season when not provided in URL params
      let effectiveLeague = leagueParam;
      let effectiveSeason = seasonParam;

      if (!effectiveLeague || !effectiveSeason) {
        // Default to 'abl' and fetch its active season year
        effectiveLeague = effectiveLeague || 'abl';
        const seasonsRes = await fetch(`/api/seasons?league=${effectiveLeague}&status=active`);
        if (seasonsRes.ok) {
          const seasons = await seasonsRes.json();
          const active = Array.isArray(seasons) ? seasons[0] : null;
          if (active?.year) {
            effectiveSeason = String(active.year);
          }
        }
        // Push resolved params into URL so the page is bookmarkable
        if (effectiveLeague && effectiveSeason) {
          setResolvedLeague(effectiveLeague);
          setResolvedSeason(effectiveSeason);
          router.replace(`/admin/new-supp-draft?league=${effectiveLeague}&season=${effectiveSeason}`);
        }
      }

      const qs = effectiveLeague && effectiveSeason
        ? `?league=${effectiveLeague}&season=${effectiveSeason}`
        : '';
      const draftRes = await fetch(`/api/supp-draft${qs}`, { cache: 'no-store' });
      const draftData = draftRes.ok ? await draftRes.json() : { draft: null };

      const d = draftData.draft;
      if (d) {
        setExistingDraft({
          _id: d._id,
          status: d.status,
          scheduledAt: d.scheduledAt,
          rounds: d.rounds,
          picksCount: (d.picks || []).length,
          dropIndicationsCount: (d.dropIndications || []).length,
          orderIds: d.orderIds || [],
        });
        setShowSetup(false);
        if (d.scheduledAt) {
          // Convert to local datetime-local format
          const dt = new Date(d.scheduledAt);
          const pad = (n: number) => String(n).padStart(2, '0');
          const local = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
          setNewScheduledAt(local);
        }
      } else {
        setExistingDraft(null);
        setShowSetup(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [leagueParam, seasonParam, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const moveTeam = (index: number, delta: -1 | 1) => {
    const next = [...startOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setStartOrder(next);
  };

  const moveReorderTeam = (index: number, delta: -1 | 1) => {
    const next = [...reorderList];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setReorderList(next);
  };

  const handleEnterReorder = async () => {
    setReorderMode(true);
    setLoadingReorderList(true);
    setError(null);
    try {
      const qs = league && season ? `?league=${league}&season=${season}` : '';
      const res = await fetch(`/api/teams${qs}`);
      if (!res.ok) throw new Error('Failed to load teams');
      const allTeams: DraftTeam[] = await res.json();
      const teamMap = new Map(allTeams.map((t) => [t._id, t]));
      const ordered = (existingDraft?.orderIds || [])
        .map((id) => teamMap.get(id))
        .filter(Boolean) as DraftTeam[];
      setReorderList(ordered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teams');
      setReorderMode(false);
    } finally {
      setLoadingReorderList(false);
    }
  };

  const handleSaveReorder = async () => {
    const confirmed = confirm(
      `Change the draft order? This only affects future picks — picks already made will not change.`,
    );
    if (!confirmed) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch('/api/supp-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league: league || 'abl',
          season: season || 'active',
          action: 'reorder',
          orderIds: reorderList.map((t) => t._id),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to reorder draft');
      }
      setReorderMode(false);
      setReorderList([]);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder draft');
    } finally {
      setWorking(false);
    }
  };

  const handlePrepareToStart = async () => {
    setPreparingToStart(true);
    setLoadingStartOrder(true);
    setError(null);
    try {
      const qs = league && season ? `?league=${league}&season=${season}` : '';
      const res = await fetch(`/api/supp-draft/order${qs}`);
      if (!res.ok) throw new Error('Failed to load current standings order');
      const data = await res.json();
      setStartOrder(data.order || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load order');
      setPreparingToStart(false);
    } finally {
      setLoadingStartOrder(false);
    }
  };

  const handleCreateDraft = async () => {
    if (existingDraft) {
      const confirmed = confirm(
        `This will abandon the existing ${existingDraft.status} supp draft (${existingDraft.picksCount} pick${existingDraft.picksCount !== 1 ? 's' : ''}). Continue?`,
      );
      if (!confirmed) return;
    }
    setWorking(true);
    setError(null);
    try {
      const scheduledAtValue = scheduledAt ? new Date(scheduledAt).toISOString() : null;
      const res = await fetch('/api/supp-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league: league || 'abl',
          season: season || 'active',
          scheduledAt: scheduledAtValue,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create supp draft');
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create supp draft');
    } finally {
      setWorking(false);
    }
  };

  const handleUpdateScheduledAt = async () => {
    setWorking(true);
    setError(null);
    try {
      const scheduledAtValue = newScheduledAt ? new Date(newScheduledAt).toISOString() : null;
      const res = await fetch('/api/supp-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league: league || 'abl',
          season: season || 'active',
          scheduledAt: scheduledAtValue,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to update scheduled time');
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update scheduled time');
    } finally {
      setWorking(false);
    }
  };

  const handleStartDraft = async () => {
    if (startOrder.length === 0) {
      setError('Draft order is empty — cannot start.');
      return;
    }
    const confirmed = confirm(
      `Lock the draft order and go live now?\n\nRounds will be calculated from current drop indications. This cannot be undone.`,
    );
    if (!confirmed) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch('/api/supp-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league: league || 'abl',
          season: season || 'active',
          action: 'start',
          orderIds: startOrder.map((t) => t._id),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to start supp draft');
      }
      router.push(suppDraftHref ?? '/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start supp draft');
      setWorking(false);
    }
  };

  const handleFinalize = async () => {
    const confirmed = confirm(
      `Finalizing will:\n• Drop all pickup players from all rosters\n• Drop all indicated players\n• Add supp draft picks (acqType: supp_draft)\n\nThis cannot be undone. Continue?`,
    );
    if (!confirmed) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch('/api/supp-draft/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league: league || 'abl', season: season || 'active' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to finalize supp draft');
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize supp draft');
    } finally {
      setWorking(false);
    }
  };

  const handleDeleteDraft = async () => {
    const confirmed = confirm(
      `Permanently delete the ${existingDraft?.status} supp draft (${existingDraft?.picksCount} pick${existingDraft?.picksCount !== 1 ? 's' : ''})? This cannot be undone.`,
    );
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      const qs = league && season ? `?league=${league}&season=${season}` : '';
      const res = await fetch(`/api/supp-draft${qs}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete supp draft');
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete supp draft');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xl text-gray-600">
        Loading...
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    active: 'bg-green-100 text-green-800 border-green-200',
    completed: 'bg-blue-100 text-blue-800 border-blue-200',
    abandoned: 'bg-gray-100 text-gray-600 border-gray-200',
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8 space-y-6">
      <div>
        <Link href={backHref} className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          &larr; Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Supplemental Draft Management</h1>
        {league && season && (
          <p className="text-sm text-gray-500 mt-0.5">{league.toUpperCase()} {season}</p>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Existing draft status card */}
      {existingDraft && (
        <div className="rounded-xl bg-white shadow border border-gray-100 divide-y">
          <div className="px-5 py-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
                Current Supp Draft
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase ${statusColors[existingDraft.status] ?? 'bg-gray-100 text-gray-700'}`}
                >
                  {existingDraft.status}
                </span>
                <span className="text-sm text-gray-700">
                  {existingDraft.rounds} rounds · {existingDraft.picksCount} pick{existingDraft.picksCount !== 1 ? 's' : ''} made
                </span>
              </div>
              {existingDraft.dropIndicationsCount > 0 && (
                <p className="mt-1 text-sm text-amber-700">
                  {existingDraft.dropIndicationsCount} drop indication{existingDraft.dropIndicationsCount !== 1 ? 's' : ''} submitted
                </p>
              )}
              {existingDraft.scheduledAt && (
                <p className="mt-1 text-sm text-gray-600">
                  Scheduled: {new Date(existingDraft.scheduledAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {(existingDraft.status === 'active' || existingDraft.status === 'pending') && suppDraftHref && (
                <Link
                  href={suppDraftHref}
                  className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  View Draft &rarr;
                </Link>
              )}
              {existingDraft.status === 'pending' && !preparingToStart && (
                <button
                  type="button"
                  onClick={handlePrepareToStart}
                  disabled={working}
                  className="rounded border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  Set Order &amp; Start
                </button>
              )}
              {existingDraft.status === 'active' && (
                <>
                  {!reorderMode && (
                    <button
                      type="button"
                      onClick={handleEnterReorder}
                      disabled={working}
                      className="rounded border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-xs font-semibold text-yellow-700 hover:bg-yellow-100 disabled:opacity-50"
                    >
                      Reorder Draft
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleFinalize}
                    disabled={working}
                    className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                  >
                    {working ? 'Finalizing...' : 'Finalize Draft'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleDeleteDraft}
                disabled={deleting}
                className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>

          {/* Reorder active draft */}
          {existingDraft.status === 'active' && reorderMode && (
            <div className="px-5 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">Reorder Draft</p>
                <button
                  type="button"
                  onClick={() => { setReorderMode(false); setReorderList([]); }}
                  className="text-xs text-gray-500 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                Changing the order only affects <strong>future picks</strong>. Picks already made will not be modified.
              </p>
              {loadingReorderList ? (
                <p className="text-sm text-gray-500">Loading teams…</p>
              ) : (
                <div className="space-y-2">
                  {reorderList.map((team, index) => (
                    <div
                      key={team._id}
                      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                    >
                      <span className="w-6 text-center text-sm font-bold text-gray-400">{index + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900">{getTeamDisplayName(team)}</div>
                        <div className="text-xs text-gray-500">{getOwnerDisplay(team)}</div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => moveReorderTeam(index, -1)}
                          disabled={index === 0}
                          className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveReorderTeam(index, 1)}
                          disabled={index === reorderList.length - 1}
                          className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleSaveReorder}
                disabled={working || loadingReorderList || reorderList.length === 0}
                className="w-full rounded-lg bg-yellow-600 py-2.5 text-sm font-semibold text-white hover:bg-yellow-700 disabled:opacity-50 transition-colors"
              >
                {working ? 'Saving…' : 'Save New Order'}
              </button>
            </div>
          )}

          {/* Update scheduled time for pending drafts */}
          {existingDraft.status === 'pending' && !preparingToStart && (
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm font-medium text-gray-700">Draft start time</p>
              <p className="text-xs text-gray-500">
                The order is determined from live standings when you start the draft — not set here.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="datetime-local"
                  value={newScheduledAt}
                  onChange={(e) => setNewScheduledAt(e.target.value)}
                  className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={handleUpdateScheduledAt}
                  disabled={working}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {working ? 'Saving...' : 'Save Time'}
                </button>
              </div>
            </div>
          )}

          {/* Start draft: order confirmation panel */}
          {existingDraft.status === 'pending' && preparingToStart && (
            <div className="px-5 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">
                  Confirm Draft Order
                </p>
                <button
                  type="button"
                  onClick={() => { setPreparingToStart(false); setStartOrder([]); }}
                  className="text-xs text-gray-500 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Order is based on live standings right now. Adjust if needed, then lock and start.
              </p>
              {loadingStartOrder ? (
                <p className="text-sm text-gray-500">Loading current standings order…</p>
              ) : (
                <div className="space-y-2">
                  {startOrder.map((team, index) => (
                    <div
                      key={team._id}
                      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                    >
                      <span className="w-6 text-center text-sm font-bold text-gray-400">{index + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900">{getTeamDisplayName(team)}</div>
                        <div className="text-xs text-gray-500">
                          {getOwnerDisplay(team)} &middot; {team.w}-{team.l} ({team.avgAblRuns.toFixed(2)} avg ABL R)
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => moveTeam(index, -1)}
                          disabled={index === 0}
                          className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTeam(index, 1)}
                          disabled={index === startOrder.length - 1}
                          className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleStartDraft}
                disabled={working || loadingStartOrder || startOrder.length === 0}
                className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {working ? 'Starting…' : 'Lock Order & Start Draft'}
              </button>
            </div>
          )}

          <div className="px-5 py-3">
            <button
              type="button"
              onClick={() => setShowSetup((v) => !v)}
              className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
            >
              {showSetup ? 'Hide setup' : 'Create a new supp draft instead...'}
            </button>
          </div>
        </div>
      )}

      {/* Create new supp draft setup form */}
      {showSetup && (
        <div className="rounded-xl bg-white shadow border border-gray-100 divide-y">
          <div className="px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">New Supplemental Draft</h2>
            <p className="text-sm text-gray-500 mt-1">
              Opening the drop-indication window lets teams start indicating players to drop.
              The draft order is determined from live standings when you actually start the draft.
            </p>
          </div>

          {/* Scheduled time */}
          <div className="px-5 py-4 space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Planned Draft Start <span className="text-gray-400 font-normal">(optional — shown to owners, not enforced)</span>
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="px-5 py-4">
            <button
              type="button"
              onClick={handleCreateDraft}
              disabled={working}
              className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {working ? 'Opening...' : 'Open Drop-Indication Window'}
            </button>
          </div>
        </div>
      )}

      {/* Info box */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-800 space-y-1.5">
        <p className="font-semibold">How the Supp Draft works</p>
        <ul className="list-disc list-inside space-y-1 text-blue-700">
          <li>Teams can indicate up to {MAX_DROP_INDICATIONS} players to drop during the <strong>pending</strong> period.</li>
          <li>Draft order is determined from <strong>live standings at start time</strong> — reverse standings, tiebreak = lower avg ABL runs.</li>
          <li>No snake — same order every round.</li>
          <li>Rounds: min 3, plus 1 extra per drop indicated by any team. Locked when draft starts.</li>
          <li>On finalize: all pickups are dropped, indicated players are dropped, supp picks are added.</li>
        </ul>
      </div>
    </div>
  );
}
