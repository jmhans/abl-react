'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  assignDraftSlots,
  buildDraftBoard,
  calculateDraftAblScore,
  DraftPlayer,
  DraftTeam,
  DraftedPlayerPick,
  getDraftEligiblePositions,
  getOwnerDisplay,
  getTeamDisplayName,
} from '@/app/lib/draft-utils';

type PlayerForDraft = DraftPlayer & {
  abl: number;
  eligible: string[];
};

type DraftApiState = {
  _id: string;
  status: 'active' | 'completed' | 'abandoned';
  orderIds: string[];
  picks: DraftedPlayerPick[];
  createdAt: string;
  completedAt: string | null;
  effectiveDate?: string | null;
};

export default function DraftPage() {
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [players, setPlayers] = useState<PlayerForDraft[]>([]);
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [picks, setPicks] = useState<DraftedPlayerPick[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<'active' | 'completed' | 'abandoned' | 'none'>('none');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlayers, setShowPlayers] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);

  const applyDraftState = (sortedTeams: DraftTeam[], draft: DraftApiState | null) => {
    const defaultOrderIds = sortedTeams.map((team) => team._id);

    if (!draft) {
      setDraftId(null);
      setDraftStatus('none');
      setOrderIds(defaultOrderIds);
      setPicks([]);
      setSelectedTeamId(defaultOrderIds[0] || '');
      return;
    }

    const validTeamIds = new Set(defaultOrderIds);
    const draftOrderIds = Array.isArray(draft.orderIds)
      ? draft.orderIds.filter((id) => validTeamIds.has(id))
      : [];

    const mergedOrderIds = [...draftOrderIds, ...defaultOrderIds.filter((id) => !draftOrderIds.includes(id))];

    setDraftId(draft._id);
    setDraftStatus(draft.status);
    setOrderIds(mergedOrderIds);
    setPicks(Array.isArray(draft.picks) ? draft.picks : []);
    setSelectedTeamId((current) => current || mergedOrderIds[0] || '');
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [teamsRes, playersRes, draftRes, adminRes] = await Promise.all([
          fetch('/api/teams'),
          fetch('/api/players'),
          fetch('/api/draft', { cache: 'no-store' }),
          fetch('/api/admin/me', { cache: 'no-store' }),
        ]);

        if (!teamsRes.ok) throw new Error('Failed to load teams');
        if (!playersRes.ok) throw new Error('Failed to load players');
        if (!draftRes.ok) throw new Error('Failed to load draft');

        const teamsData = (await teamsRes.json()) as DraftTeam[];
        const playersData = (await playersRes.json()) as DraftPlayer[];
        const draftData = (await draftRes.json()) as { draft: DraftApiState | null };
        const adminData = adminRes.ok ? await adminRes.json() : { isAdmin: false };

        const sortedTeams = [...teamsData].sort((a, b) => getTeamDisplayName(a).localeCompare(getTeamDisplayName(b)));
        const enrichedPlayers = playersData
          .map((player) => ({
            ...player,
            eligible: getDraftEligiblePositions(player),
            abl: calculateDraftAblScore(player.stats),
          }))
          .sort((a, b) => {
            if (b.abl !== a.abl) return b.abl - a.abl;
            return a.name.localeCompare(b.name);
          });

        setTeams(sortedTeams);
        setPlayers(enrichedPlayers);
        setIsAdmin(Boolean(adminData?.isAdmin));
        applyDraftState(sortedTeams, draftData.draft || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load draft page');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const orderedTeams = useMemo(() => {
    const teamMap = new Map(teams.map((team) => [team._id, team]));
    return orderIds.map((id) => teamMap.get(id)).filter(Boolean) as DraftTeam[];
  }, [teams, orderIds]);

  const draftBoard = useMemo(() => buildDraftBoard(orderedTeams.map((team) => team._id)), [orderedTeams]);
  const currentPick = draftBoard[picks.length] || null;
  const draftedPlayerIds = useMemo(() => new Set(picks.map((pick) => pick.player._id)), [picks]);

  const currentTeam = currentPick ? orderedTeams.find((team) => team._id === currentPick.teamId) || null : null;

  const availablePlayers = useMemo(() => {
    return players.filter((player) => {
      if (draftedPlayerIds.has(player._id)) return false;

      if (activeOnly) {
        // Only show players explicitly on an active MLB roster.
        // null/undefined status means the player is not on any current 40-man roster.
        if (!player.status || player.status.toLowerCase() !== 'active') return false;
      }

      const matchesSearch =
        search.trim().length === 0 ||
        player.name.toLowerCase().includes(search.toLowerCase()) ||
        (player.team || '').toLowerCase().includes(search.toLowerCase());

      const matchesPosition =
        positionFilter === 'ALL' || player.eligible.map((p) => p.toUpperCase()).includes(positionFilter);

      return matchesSearch && matchesPosition;
    });
  }, [players, draftedPlayerIds, search, positionFilter, activeOnly]);

  const selectedTeam = useMemo(() => {
    return orderedTeams.find((team) => team._id === selectedTeamId) || orderedTeams[0] || null;
  }, [orderedTeams, selectedTeamId]);

  const selectedTeamPicks = useMemo(() => {
    if (!selectedTeam) return [];
    return picks.filter((pick) => pick.pick.teamId === selectedTeam._id);
  }, [picks, selectedTeam]);

  const selectedTeamSlots = useMemo(() => assignDraftSlots(selectedTeamPicks), [selectedTeamPicks]);

  const currentTeamPicks = useMemo(() => {
    if (!currentTeam) return [];
    return picks.filter((pick) => pick.pick.teamId === currentTeam._id);
  }, [picks, currentTeam]);

  const currentTeamSlots = useMemo(() => assignDraftSlots(currentTeamPicks), [currentTeamPicks]);

  const activeDraft = draftStatus === 'active';

  const positionOptions = useMemo(() => {
    const positions = new Set<string>();
    players.forEach((player) => player.eligible.forEach((pos) => positions.add(pos.toUpperCase())));
    return ['ALL', ...Array.from(positions).sort()];
  }, [players]);

  const moveTeam = async (index: number, delta: -1 | 1) => {
    if (!isAdmin || picks.length > 0) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= orderIds.length) return;

    const next = [...orderIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];

    setOrderIds(next);

    if (activeDraft) {
      try {
        const res = await fetch('/api/draft/order', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderIds: next }),
        });

        if (!res.ok) {
          throw new Error('Failed to save draft order');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save draft order');
      }
    }

    if (!selectedTeamId) {
      setSelectedTeamId(next[0]);
    }
  };

  const refreshDraft = async () => {
    const [draftRes, teamsRes] = await Promise.all([
      fetch('/api/draft', { cache: 'no-store' }),
      fetch('/api/teams', { cache: 'no-store' }),
    ]);

    if (!draftRes.ok || !teamsRes.ok) {
      throw new Error('Failed to refresh draft state');
    }

    const draftData = (await draftRes.json()) as { draft: DraftApiState | null };
    const teamsData = (await teamsRes.json()) as DraftTeam[];
    const sortedTeams = [...teamsData].sort((a, b) => getTeamDisplayName(a).localeCompare(getTeamDisplayName(b)));
    setTeams(sortedTeams);
    applyDraftState(sortedTeams, draftData.draft || null);
  };

  const handleCreateDraft = async () => {
    if (!isAdmin) return;
    try {
      setIsWorking(true);
      setError(null);
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create draft');
      }

      await refreshDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create draft');
    } finally {
      setIsWorking(false);
    }
  };

  const handleDraftPlayer = async (player: PlayerForDraft) => {
    if (!activeDraft || !currentPick) return;
    try {
      setIsWorking(true);
      setError(null);
      const res = await fetch('/api/draft/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: player._id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to draft player');
      }

      await refreshDraft();
      if (selectedTeamId === '' && currentTeam) {
        setSelectedTeamId(currentTeam._id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft player');
    } finally {
      setIsWorking(false);
    }
  };

  const handleUndo = async () => {
    if (!activeDraft) return;
    try {
      setIsWorking(true);
      setError(null);
      const res = await fetch('/api/draft/undo', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to undo pick');
      }
      await refreshDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo pick');
    } finally {
      setIsWorking(false);
    }
  };

  const handleFinalize = async () => {
    if (!isAdmin || !activeDraft) return;
    if (!confirm('Finalize draft and create lineups for all teams?')) return;

    try {
      setIsWorking(true);
      setError(null);
      const res = await fetch('/api/draft/finalize', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to finalize draft');
      }
      await refreshDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize draft');
    } finally {
      setIsWorking(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-xl">Loading draft room...</div>;
  }

  if (error) {
    return <div className="flex min-h-screen items-center justify-center text-xl text-red-600">{error}</div>;
  }

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/" className="mb-3 inline-block text-blue-600 hover:text-blue-800">
            ← Back to Home
          </Link>
          <h1 className="text-4xl font-bold text-gray-900">ABL Draft Room</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!activeDraft || picks.length === 0 || isWorking}
            className="rounded bg-amber-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Undo Last Pick
          </button>
          {isAdmin && activeDraft && (
            <button
              type="button"
              onClick={handleFinalize}
              disabled={isWorking || picks.length === 0}
              className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Finalize Draft
            </button>
          )}
        </div>
      </div>

      {!activeDraft && (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No active draft.{' '}
          {isAdmin ? (
            <>
              <Link href="/admin/new-draft" className="underline hover:text-amber-900">
                Create a new draft
              </Link>{' '}from the Admin page to start drafting.
            </>
          ) : (
            'Waiting for an admin to create a draft.'
          )}
        </div>
      )}

      <section className="rounded-lg bg-white p-4 shadow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Draft progress by team</h2>
          <span className="text-xs text-gray-500">{picks.length}/{draftBoard.length || 240} picks</span>
        </div>
        <div className="grid grid-cols-5 gap-2 md:grid-cols-10">
          {orderedTeams.map((team, index) => {
            const teamPicks = picks.filter((pick) => pick.pick.teamId === team._id);
            const teamSlots = assignDraftSlots(teamPicks);
            const nextPickForTeam = draftBoard.find(
              (pick) => pick.teamId === team._id && picks.length <= pick.overallPick,
            );
            const isCurrent = currentTeam?._id === team._id;
            const currentRound = currentPick?.round || 0;
            const isSnakeGoingDown = currentRound % 2 === 1; // Round 1,3,5... go down (1-10)

            return (
              <div
                key={team._id}
                className={`flex flex-col items-center justify-center rounded-lg border-2 p-3 text-center transition-all ${
                  isCurrent
                    ? 'border-blue-500 bg-blue-100 shadow-lg'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="text-xs font-semibold uppercase text-gray-500">{index + 1}</div>
                <div className="mt-1 line-clamp-2 text-sm font-medium text-gray-900">
                  {getTeamDisplayName(team)}
                </div>
                <div className="mt-2 text-xs text-gray-700">
                  {teamPicks.length > 0 ? (
                    <div className="space-y-0.5">
                      {teamSlots.requiredSlots.map((slot) => (
                        <div key={slot.label}>
                          <span className="font-semibold">{slot.label}:</span> {slot.player ? '✓' : '−'}
                        </div>
                      ))}
                      {teamSlots.extras.length > 0 && (
                        <div>
                          <span className="font-semibold">Extra:</span> {teamSlots.extras.length}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-500">No picks</span>
                  )}
                </div>
                {nextPickForTeam && (
                  <div className="mt-1 text-xs text-gray-600">
                    #{nextPickForTeam.overallPick}
                  </div>
                )}
                {isCurrent && (
                  <div className="mt-2 text-xl font-bold text-blue-600">
                    {isSnakeGoingDown ? '→' : '←'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {showPlayers ? (
          <section className="space-y-4 rounded-lg bg-white p-4 shadow">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Available players</h2>
              <p className="text-sm text-gray-600">Search and draft from the current board. Players are sorted by ABL score, then name.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowPlayers(false)}
              className="text-gray-500 hover:text-gray-700"
              title="Hide players panel"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <input
                type="text"
                placeholder="Search player or MLB team"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded border px-3 py-2"
              />
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
                className="rounded border px-3 py-2"
              >
                {positionOptions.map((position) => (
                  <option key={position} value={position}>
                    {position === 'ALL' ? 'All positions' : position}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setActiveOnly((v) => !v)}
                className={`rounded border px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  activeOnly
                    ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    : 'border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100'
                }`}
              >
                {activeOnly ? 'Include players not on active rosters' : 'Active roster players only'}
              </button>
            </div>

          <div className="rounded-lg border border-gray-200">
            <div className="grid grid-cols-[minmax(0,1.5fr)_7rem_8rem_7rem_9rem] gap-3 border-b bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <div>Player</div>
              <div>MLB</div>
              <div>Eligible</div>
              <div>ABL</div>
              <div>Action</div>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              {availablePlayers.map((player) => (
                <div
                  key={player._id}
                  className="grid grid-cols-[minmax(0,1.5fr)_7rem_8rem_7rem_9rem] gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                >
                  <div>
                    <div className="font-medium text-gray-900">{player.name}</div>
                    <div className="text-xs text-gray-500">{player.status || '—'}</div>
                  </div>
                  <div className="text-gray-700">{player.team || 'FA'}</div>
                  <div className="text-gray-700">{player.eligible.join(', ')}</div>
                  <div className={`${player.abl >= 0 ? 'text-green-700' : 'text-red-700'} font-medium`}>
                    {player.abl.toFixed(2)}
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => handleDraftPlayer(player)}
                      disabled={!activeDraft || !currentPick || isWorking}
                      className="rounded bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      Draft
                    </button>
                  </div>
                </div>
              ))}

              {availablePlayers.length === 0 && (
                <div className="px-4 py-10 text-center text-gray-500">No available players match the current filters.</div>
              )}
            </div>
          </div>
        </section>
        ) : (
          <div className="flex items-center justify-center rounded-lg bg-white p-4 shadow">
            <button
              type="button"
              onClick={() => setShowPlayers(true)}
              className="rounded bg-blue-600 px-4 py-3 text-white hover:bg-blue-700"
            >
              ☰ Show Players
            </button>
          </div>
        )}

        <section className="space-y-4 rounded-lg bg-white p-4 shadow">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="text-sm font-semibold uppercase tracking-wide text-blue-700">On the clock</div>
            {currentPick && currentTeam ? (
              <>
                <div className="mt-2 text-2xl font-bold text-gray-900">{getTeamDisplayName(currentTeam)}</div>
                <div className="mt-1 text-sm text-gray-600">{getOwnerDisplay(currentTeam)}</div>
                <div className="mt-3 text-sm text-gray-700">
                  Pick {currentPick.overallPick} • Round {currentPick.round}
                  {currentPick.grouped && currentPick.groupStartRound && currentPick.groupEndRound && (
                    <span> • grouped rounds {currentPick.groupStartRound}-{currentPick.groupEndRound}</span>
                  )}
                </div>
                <div className="mt-3 text-sm text-gray-700">
                  Required slots filled: {currentTeamSlots.filledRequiredCount}/8
                  {currentTeamSlots.missingRequiredCount > 0 && (
                    <span className="text-amber-700"> • still need {currentTeamSlots.missingRequiredCount}</span>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-2 text-lg font-semibold text-green-700">Draft complete</div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-gray-200 p-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Draft history</h2>
              <p className="text-xs text-gray-600">View team picks by required slots, then extras.</p>
            </div>
            <select
              value={selectedTeam?._id || ''}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="w-full rounded border px-3 py-2"
            >
              {orderedTeams.map((team) => (
                <option key={team._id} value={team._id}>
                  {getTeamDisplayName(team)}
                </option>
              ))}
            </select>
            {selectedTeam && (
              <div className="text-xs text-gray-600">{getOwnerDisplay(selectedTeam)}</div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Required slots</h3>
              <div className="text-sm text-gray-600">
                {selectedTeamSlots.filledRequiredCount}/8 filled
              </div>
            </div>
            <div className="space-y-2">
              {selectedTeamSlots.requiredSlots.map((slot) => (
                <div key={slot.label} className="rounded border border-gray-200 px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{slot.label}</div>
                  {slot.player ? (
                    <div className="mt-1">
                      <div className="font-medium text-gray-900">{slot.player.player.name}</div>
                      <div className="text-xs text-gray-500">
                        Pick #{slot.player.pick.overallPick} • {slot.player.player.team || 'FA'} • {slot.player.player.eligible.join(', ')}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-amber-700">Open</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="mb-3 font-semibold text-gray-900">Extra picks</h3>
            <div className="space-y-2">
              {selectedTeamSlots.extras.length > 0 ? (
                selectedTeamSlots.extras.map((pick) => (
                  <div key={`${pick.pick.overallPick}-${pick.player._id}`} className="rounded border border-gray-200 px-3 py-2">
                    <div className="font-medium text-gray-900">{pick.player.name}</div>
                    <div className="text-xs text-gray-500">
                      Pick #{pick.pick.overallPick} • {pick.player.team || 'FA'} • {pick.player.eligible.join(', ')}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500">No extra picks yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="mb-3 font-semibold text-gray-900">Team pick log</h3>
            <div className="max-h-[18rem] space-y-2 overflow-auto pr-1">
              {selectedTeamPicks.length > 0 ? (
                selectedTeamPicks.map((pick) => (
                  <div key={`${pick.pick.overallPick}-${pick.player._id}`} className="rounded border border-gray-200 px-3 py-2">
                    <div className="font-medium text-gray-900">#{pick.pick.overallPick} • {pick.player.name}</div>
                    <div className="text-xs text-gray-500">
                      Round {pick.pick.round} • {pick.player.team || 'FA'} • {pick.player.eligible.join(', ')}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500">No picks yet for this team.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
