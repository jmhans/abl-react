'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assignDraftSlots,
  buildDraftBoard,
  calculateDraftAblScore,
  DraftPlayer,
  DraftTeam,
  DraftedPlayerPick,
  getDraftEligiblePositions,
  getEffectivePickCounts,
  getOwnerDisplay,
  getTeamDisplayName,
  STANDARD_SNAKE_ROUNDS,
  TOTAL_DRAFT_ROUNDS,
} from '@/app/lib/draft-utils';
import { useLeagueSeason } from '@/app/lib/league-season-context';
import type { ProjectionStats } from '@/app/lib/projection-utils';

type PlayerForDraft = DraftPlayer & {
  abl: number;
  ablProjected: number | null;
  projSystem: string | null;
  projStats: ProjectionStats | null;
  eligible: string[];
};

type DraftApiState = {
  _id: string;
  status: 'active' | 'completed' | 'abandoned';
  orderIds: string[];
  picks: DraftedPlayerPick[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  effectiveDate?: string | null;
};

type DisplayStats = {
  g: number | null;
  ab: number | null;
  h: number | null;
  doubles: number | null;
  triples: number | null;
  hr: number | null;
  bb: number | null;
  netSb: number | null;
  hbp: number | null;
  sh: number | null;
  sf: number | null;
  ablScore: number | null;
};

function getDisplayStats(player: PlayerForDraft, view: string): DisplayStats {
  if (view === 'actual') {
    const b = player.stats?.batting;
    const ab = b?.atBats ?? 0;
    const bb = b?.baseOnBalls ?? 0;
    const hbp = b?.hitByPitch ?? 0;
    const sb = b?.stolenBases ?? null;
    const cs = b?.caughtStealing ?? null;
    return {
      g: (b?.gamesPlayed || null),
      ab: ab > 0 ? ab : null,
      h: b?.hits ?? null,
      doubles: b?.doubles ?? null,
      triples: b?.triples ?? null,
      hr: b?.homeRuns ?? null,
      bb: bb > 0 ? bb : null,
      netSb: (sb !== null || cs !== null) ? (sb ?? 0) - (cs ?? 0) : null,
      hbp: hbp > 0 ? hbp : null,
      sh: b?.sacrificeBunts ?? null,
      sf: b?.sacrificeFlies ?? null,
      ablScore: player.abl,
    };
  }
  const p = player.projStats;
  const sb = p?.sb ?? null;
  const cs = p?.cs ?? null;
  return {
    g: p?.g ?? null,
    ab: p?.ab ?? null,
    h: p?.h ?? null,
    doubles: p?.doubles ?? null,
    triples: p?.triples ?? null,
    hr: p?.hr ?? null,
    bb: p?.bb ?? null,
    netSb: (sb !== null || cs !== null) ? (sb ?? 0) - (cs ?? 0) : null,
    hbp: p?.hbp ?? null,
    sh: p?.sacBunts ?? null,
    sf: p?.sacFlies ?? null,
    ablScore: player.ablProjected,
  };
}

type SortColKey = 'g' | 'ab' | 'h' | 'doubles' | 'triples' | 'hr' | 'bb' | 'hbp' | 'netSb' | 'sh' | 'sf' | 'abl';
const STAT_COL_KEYS: SortColKey[] = ['g', 'ab', 'h', 'doubles', 'triples', 'hr', 'bb', 'hbp', 'netSb', 'sh', 'sf'];

const STAT_COLS = ['G', 'AB', 'H', '2B', '3B', 'HR', 'BB', 'HBP', 'SB(net)', 'SH', 'SF'] as const;
// xs: Player | ABL | Action (3 cols)
// sm: Player | AB | ABL | Action (4 cols)
// md+: Player | G AB H 2B 3B HR BB HBP SB(net) SH SF | ABL | Action (14 cols)
const GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem_4rem] sm:grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_4rem] md:grid-cols-[minmax(0,2fr)_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_3rem_4.5rem_4rem]';
// Visibility per stat column (matches DOM order: G AB H 2B 3B HR BB HBP SB(net) SH SF)
const STAT_VIS = ['hidden md:block', 'hidden sm:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden lg:block', 'hidden lg:block'] as const;



export default function DraftPage() {
  const { league, season } = useLeagueSeason();

  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [players, setPlayers] = useState<PlayerForDraft[]>([]);
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [picks, setPicks] = useState<DraftedPlayerPick[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<'active' | 'completed' | 'abandoned' | 'none'>('none');
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userSub, setUserSub] = useState<string | null>(null);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [adminPickMode, setAdminPickMode] = useState(false);
  const [draftStartedAt, setDraftStartedAt] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlayers, setShowPlayers] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [statView, setStatView] = useState<string>('actual');
  const [projSystems, setProjSystems] = useState<string[]>([]);
  const [projLoading, setProjLoading] = useState(false);
  const [sortCol, setSortCol] = useState<SortColKey | null>(null);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

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
    setDraftStartedAt(draft.startedAt ?? null);
    setOrderIds(mergedOrderIds);
    setPicks(Array.isArray(draft.picks) ? draft.picks : []);
    setSelectedTeamId((current) => current || mergedOrderIds[0] || '');
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [teamsRes, draftRes, adminRes, projSummaryRes, userRes, myLeaguesRes] = await Promise.all([
          fetch(`/api/teams?league=${league}&season=${season}`),
          fetch(`/api/draft?league=${league}&season=${season}`, { cache: 'no-store' }),
          fetch('/api/admin/me', { cache: 'no-store' }),
          fetch('/api/projections'),
          fetch('/api/auth/me').catch(() => null),
          fetch('/api/auth/my-leagues').catch(() => null),
        ]);

        if (!teamsRes.ok) throw new Error('Failed to load teams');
        if (!draftRes.ok) throw new Error('Failed to load draft');

        const teamsData = (await teamsRes.json()) as DraftTeam[];
        const draftData = (await draftRes.json()) as { draft: DraftApiState | null };
        const adminData = adminRes.ok ? await adminRes.json() : { isAdmin: false };
        const userData = userRes?.ok ? await userRes.json() : null;
        setUserEmail(userData?.user?.email ?? null);
        setUserSub(userData?.user?.sub ?? null);

        // Derive user's team in this league/season via my-leagues (handles primary + co-owners)
        const myLeaguesData = myLeaguesRes?.ok ? await myLeaguesRes.json() : [];
        const myEntry = (Array.isArray(myLeaguesData) ? myLeaguesData : []).find(
          (e: any) => e.league?.slug === league && String(e.season?.year) === String(season)
        );
        if (myEntry?.team?._id) setUserTeamId(myEntry.team._id);

        // Determine available projection systems for this season
        const projSummaryData = projSummaryRes.ok ? await projSummaryRes.json() : { summary: [] };
        const seasonNum = Number(season);
        const systems: string[] = (projSummaryData.summary as Array<{ _id: { season: number; projSystem: string } }>)
          .filter((s) => s._id.season === seasonNum)
          .map((s) => s._id.projSystem);
        setProjSystems(systems);
        const defaultView = systems.length > 0 ? systems[0] : 'actual';
        setStatView(defaultView);

        // Fetch players filtered to the default projection system
        const playersUrl = defaultView !== 'actual'
          ? `/api/players?projSystem=${encodeURIComponent(defaultView)}`
          : '/api/players';
        const playersRes = await fetch(playersUrl);
        if (!playersRes.ok) throw new Error('Failed to load players');
        const playersData = (await playersRes.json()) as DraftPlayer[];

        const sortedTeams = [...teamsData].sort((a, b) => getTeamDisplayName(a).localeCompare(getTeamDisplayName(b)));
        const enrichedPlayers = playersData
          .map((player: any) => ({
            ...player,
            eligible: getDraftEligiblePositions(player),
            abl: calculateDraftAblScore(player.stats),
            ablProjected: player.ablProjected ?? null,
            projSystem: player.projSystem ?? null,
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

  const handleStatViewChange = async (newView: string) => {
    setStatView(newView);
    setSortCol(null);
    setSortDir('desc');
    setProjLoading(true);
    try {
      const url = newView !== 'actual'
        ? `/api/players?projSystem=${encodeURIComponent(newView)}`
        : '/api/players';
      const res = await fetch(url);
      if (!res.ok) return;
      const playersData = (await res.json()) as DraftPlayer[];
      setPlayers(
        playersData
          .map((player: any) => ({
            ...player,
            eligible: getDraftEligiblePositions(player),
            abl: calculateDraftAblScore(player.stats),
            ablProjected: player.ablProjected ?? null,
            projSystem: player.projSystem ?? null,
          }))
          .sort((a, b) => {
            if (b.abl !== a.abl) return b.abl - a.abl;
            return a.name.localeCompare(b.name);
          }),
      );
    } finally {
      setProjLoading(false);
    }
  };

  const handleColSort = (col: SortColKey) => {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortDir('asc');
    } else {
      setSortCol(null);
      setSortDir('desc');
    }
  };

  const sortIcon = (col: SortColKey) => {
    if (sortCol !== col) return <span className="ml-0.5 opacity-20">↕</span>;
    return <span className="ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  const orderedTeams = useMemo(() => {
    const teamMap = new Map(teams.map((team) => [team._id, team]));
    return orderIds.map((id) => teamMap.get(id)).filter(Boolean) as DraftTeam[];
  }, [teams, orderIds]);

  const draftBoard = useMemo(() => buildDraftBoard(orderedTeams.map((team) => team._id)), [orderedTeams]);
  const currentPick = draftBoard[picks.length] || null;
  const draftedPlayerIds = useMemo(() => new Set(picks.map((pick) => pick.player._id)), [picks]);

  const currentTeam = currentPick ? orderedTeams.find((team) => team._id === currentPick.teamId) || null : null;

  const sortedPlayers = useMemo(() => {
    const getVal = (player: PlayerForDraft, col: SortColKey): number | null => {
      const ds = getDisplayStats(player, statView);
      return col === 'abl' ? ds.ablScore : ds[col];
    };
    return [...players].sort((a, b) => {
      if (sortCol) {
        const nullVal = sortDir === 'desc' ? -Infinity : Infinity;
        const av = getVal(a, sortCol) ?? nullVal;
        const bv = getVal(b, sortCol) ?? nullVal;
        return sortDir === 'desc' ? bv - av : av - bv;
      }
      // Default: ABL descending
      if (statView !== 'actual') {
        const aHas = a.ablProjected !== null;
        const bHas = b.ablProjected !== null;
        if (!aHas && !bHas) return a.name.localeCompare(b.name);
        if (!aHas) return 1;
        if (!bHas) return -1;
        if (b.ablProjected !== a.ablProjected) return b.ablProjected! - a.ablProjected!;
        return a.name.localeCompare(b.name);
      }
      if (b.abl !== a.abl) return b.abl - a.abl;
      return a.name.localeCompare(b.name);
    });
  }, [players, statView, sortCol, sortDir]);

  const availablePlayers = useMemo(() => {
    return sortedPlayers.filter((player) => {
      if (draftedPlayerIds.has(player._id)) return false;

      if (activeOnly) {
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
  }, [sortedPlayers, draftedPlayerIds, search, positionFilter, activeOnly]);

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

  const picksByRoundAndTeam = useMemo(() => {
    const map = new Map<number, Map<string, DraftedPlayerPick>>();
    for (const p of picks) {
      const round = p.pick.round;
      if (!map.has(round)) map.set(round, new Map());
      map.get(round)!.set(p.pick.teamId, p);
    }
    return map;
  }, [picks]);

  const activeDraft = draftStatus === 'active';

  const isOnClock = useMemo(() => {
    if (!currentTeam) return false;
    // Use my-leagues-derived team ID as primary check (handles co-owners)
    if (userTeamId && currentTeam._id === userTeamId) return true;
    // Fall back to direct owner record matching
    return (currentTeam.owners ?? []).some((o: any) =>
      (userSub && o.userId && o.userId === userSub) ||
      (userEmail && o.email && o.email.toLowerCase() === userEmail.toLowerCase())
    );
  }, [userTeamId, userSub, userEmail, currentTeam]);

  const canPick = activeDraft && !!currentPick && !!draftStartedAt && (isOnClock || (isAdmin && adminPickMode));

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
          body: JSON.stringify({ orderIds: next, league, season }),
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

  const refreshDraft = useCallback(async () => {
    const [draftRes, teamsRes] = await Promise.all([
      fetch(`/api/draft?league=${league}&season=${season}`, { cache: 'no-store' }),
      fetch(`/api/teams?league=${league}&season=${season}`, { cache: 'no-store' }),
    ]);

    if (!draftRes.ok || !teamsRes.ok) {
      throw new Error('Failed to refresh draft state');
    }

    const draftData = (await draftRes.json()) as { draft: DraftApiState | null };
    const teamsData = (await teamsRes.json()) as DraftTeam[];
    const sortedTeams = [...teamsData].sort((a, b) => getTeamDisplayName(a).localeCompare(getTeamDisplayName(b)));
    setTeams(sortedTeams);
    applyDraftState(sortedTeams, draftData.draft || null);
  }, [league, season]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (draftStatus !== 'active') {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => {
      refreshDraft().catch(() => {});
    }, 5000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [draftStatus, refreshDraft]);

  const handleCreateDraft = async () => {
    if (!isAdmin) return;
    try {
      setIsWorking(true);
      setError(null);
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds, league, season }),
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
        body: JSON.stringify({ playerId: player._id, league, season }),
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
      const res = await fetch('/api/draft/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, season }),
      });
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
      const res = await fetch('/api/draft/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, season }),
      });
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

  const handleStartPicks = async () => {
    if (!isAdmin || !activeDraft) return;
    if (!confirm('Start the draft clock now? This will log the official start time and open picks for all owners.')) return;
    try {
      setIsWorking(true);
      setError(null);
      const res = await fetch(`/api/draft/start?league=${league}&season=${season}`, { method: 'PATCH' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to start picks');
      }
      await refreshDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start picks');
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
          <Link href={`/${league}/${season}`} className="mb-3 inline-block text-blue-600 hover:text-blue-800">
            ← Back to Home
          </Link>
          <h1 className="text-4xl font-bold text-gray-900">ABL Draft Room</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && activeDraft && !draftStartedAt && (
            <button
              type="button"
              onClick={handleStartPicks}
              disabled={isWorking}
              className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              🏁 Start Picks
            </button>
          )}
          {isAdmin && activeDraft && (
            <button
              type="button"
              onClick={() => setAdminPickMode((v) => !v)}
              className={`rounded px-4 py-2 text-sm font-medium transition-colors ${
                adminPickMode
                  ? 'bg-orange-100 text-orange-800 ring-2 ring-orange-400 hover:bg-orange-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {adminPickMode ? '🔓 Admin Pick Mode ON' : '🔒 Admin Pick Mode'}
            </button>
          )}
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

      {activeDraft && !draftStartedAt && (
        <div className="rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          ⏳ Draft is activated but picks have not started yet.{' '}
          {isAdmin ? 'Click "Start Picks" when ready to begin.' : 'Waiting for the commissioner to start picks.'}
        </div>
      )}

      {activeDraft && draftStartedAt && picks.length > 0 && (() => {
        const startMs = new Date(draftStartedAt).getTime();
        const nowMs = Date.now();
        const elapsedMs = nowMs - startMs;
        const { completed, remaining } = getEffectivePickCounts(draftBoard, picks.length);
        const avgMsPerPick = completed > 0 ? elapsedMs / completed : null;
        const estimatedFinish = avgMsPerPick !== null
          ? new Date(nowMs + avgMsPerPick * remaining)
          : null;
        const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const fmtDur = (ms: number) => {
          const totalMin = Math.round(ms / 60000);
          if (totalMin < 60) return `${totalMin}m`;
          return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
        };
        return (
          <div className="rounded border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 flex flex-wrap gap-x-6 gap-y-1 items-center">
            <span>⏱ <strong>Elapsed:</strong> {fmtDur(elapsedMs)}</span>
            <span>📊 <strong>Avg per pick:</strong> {avgMsPerPick !== null ? fmtDur(avgMsPerPick) : '—'}</span>
            <span>🎯 <strong>Picks remaining:</strong> {remaining} effective</span>
            {estimatedFinish && (
              <span>🏁 <strong>Est. finish:</strong> {fmtTime(estimatedFinish)}{remaining === 0 ? ' (complete!)' : ''}</span>
            )}
          </div>
        );
      })()}

      {draftStatus !== 'completed' && (
      <section className="rounded-lg bg-white p-4 shadow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Draft progress by team</h2>
          <span className="text-xs text-gray-500">{picks.length}/{draftBoard.length || 240} picks</span>
        </div>
        <div className="grid grid-cols-5 gap-2 md:grid-cols-10">
          {orderedTeams.map((team, index) => {
            const teamPicks = picks.filter((pick) => pick.pick.teamId === team._id);
            const nextPickForTeam = draftBoard.find(
              (pick) => pick.teamId === team._id && picks.length <= pick.overallPick,
            );
            const isCurrent = currentTeam?._id === team._id;
            const currentRound = currentPick?.round || 0;
            const isSnakeGoingDown = currentRound % 2 === 1;
            const nextBoardPick = draftBoard[picks.length + 1] ?? null;
            const picksAgainNext = nextBoardPick?.teamId === currentPick?.teamId;

            return (
              <div
                key={team._id}
                className={`flex flex-col items-center justify-center rounded-lg border-2 p-3 text-center transition-all ${
                  isCurrent ? 'border-blue-500 bg-blue-100 shadow-lg' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="text-xs font-semibold uppercase text-gray-500">{index + 1}</div>
                <div className="mt-1 line-clamp-2 text-sm font-medium text-gray-900">
                  {getTeamDisplayName(team)}
                </div>
                <div className="mt-2 text-xs text-gray-700">
                  {teamPicks.length > 0 ? (
                    <div className="space-y-0.5">
                      {(() => {
                        const POS_ORDER = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];
                        const counts = new Map<string, number>();
                        for (const { player } of teamPicks) {
                          const raw = (player.eligible?.[0] ?? 'DH');
                          const pos = ['LF','CF','RF'].includes(raw.toUpperCase()) ? 'OF' : raw.toUpperCase();
                          counts.set(pos, (counts.get(pos) ?? 0) + 1);
                        }
                        const allPos = [...new Set([...POS_ORDER, ...counts.keys()])].filter(p => counts.has(p));
                        return allPos.map((pos) => (
                          <div key={pos}>
                            <span className="font-semibold">{pos}:</span> {counts.get(pos)}
                          </div>
                        ));
                      })()}
                    </div>
                  ) : (
                    <span className="text-gray-500">No picks</span>
                  )}
                </div>
                {nextPickForTeam && (
                  <div className="mt-1 text-xs text-gray-600">#{nextPickForTeam.overallPick}</div>
                )}
                {isCurrent && (
                  <div className="mt-2 text-xl font-bold text-blue-600">
                    {picksAgainNext ? '↓' : (isSnakeGoingDown ? '→' : '←')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      )}

      {draftStatus !== 'completed' && (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {showPlayers ? (
          <section className="space-y-4 rounded-lg bg-white p-4 shadow">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Available players</h2>
                <p className="text-sm text-gray-600">Players sorted by {statView === 'actual' ? 'actual YTD ABL score' : `${statView} projected ABL`}.</p>
                <p className="text-xs text-gray-400 mt-1">{availablePlayers.length} player{availablePlayers.length !== 1 ? 's' : ''}</p>
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
              <select
                value={statView}
                onChange={(e) => handleStatViewChange(e.target.value)}
                disabled={projLoading}
                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="actual">Actual (YTD)</option>
                {projSystems.map((sys) => (
                  <option key={sys} value={sys}>Proj: {sys}</option>
                ))}
              </select>
            </div>

            <div className="overflow-auto rounded-lg border border-gray-200 max-h-[70vh]">
              <div className={`${GRID} gap-x-2 sticky top-0 z-10 border-b bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500`}>
                <div>Player</div>
                {STAT_COLS.map((col, i) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => handleColSort(STAT_COL_KEYS[i])}
                    className={`text-center cursor-pointer hover:text-gray-900 ${STAT_VIS[i]}`}
                  >
                    {col}{sortIcon(STAT_COL_KEYS[i])}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handleColSort('abl')}
                  className={`text-center cursor-pointer hover:text-gray-900 ${
                    statView !== 'actual' ? 'text-blue-600' : 'text-green-700'
                  }`}
                >
                  {projLoading ? '…' : (statView !== 'actual' ? 'ABL★' : 'ABL')}{sortIcon('abl')}
                </button>
                <div>Action</div>
              </div>
              {availablePlayers.map((player) => {
                const ds = getDisplayStats(player, statView);
                const fmt = (v: number | null) => v === null ? '—' : String(Math.round(v));
                const ablColor = ds.ablScore === null ? 'text-gray-300'
                  : ds.ablScore >= 0
                    ? (statView !== 'actual' ? 'text-blue-700' : 'text-green-700')
                    : 'text-red-500';
                const statC = (v: number | null) => v === null ? 'text-gray-300' : 'text-gray-700';
                return (
                  <div
                    key={player._id}
                    className={`${GRID} gap-x-2 items-center border-b px-4 py-2 text-sm last:border-b-0`}
                  >
                    <div>
                      <div className="font-medium text-gray-900 leading-tight">{player.name}</div>
                      <div className="text-xs text-gray-500">{player.team || 'FA'} – {player.eligible.join(', ')}</div>
                      {player.status && <div className="text-xs text-gray-400">{player.status}</div>}
                    </div>
                    <div className={`text-center text-xs ${STAT_VIS[0]} ${statC(ds.g)}`}>{fmt(ds.g)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[1]} ${statC(ds.ab)}`}>{fmt(ds.ab)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[2]} ${statC(ds.h)}`}>{fmt(ds.h)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[3]} ${statC(ds.doubles)}`}>{fmt(ds.doubles)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[4]} ${statC(ds.triples)}`}>{fmt(ds.triples)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[5]} ${statC(ds.hr)}`}>{fmt(ds.hr)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[6]} ${statC(ds.bb)}`}>{fmt(ds.bb)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[7]} ${statC(ds.hbp)}`}>{fmt(ds.hbp)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[8]} ${statC(ds.netSb)}`}>{fmt(ds.netSb)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[9]} ${statC(ds.sh)}`}>{fmt(ds.sh)}</div>
                    <div className={`text-center text-xs ${STAT_VIS[10]} ${statC(ds.sf)}`}>{fmt(ds.sf)}</div>
                    <div className={`text-center text-xs font-medium ${ablColor}`}>
                      {ds.ablScore !== null ? ds.ablScore.toFixed(2) : '—'}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleDraftPlayer(player)}
                        disabled={!canPick || isWorking}
                        className="rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        Draft
                      </button>
                    </div>
                  </div>
                );
              })}
              {availablePlayers.length === 0 && (
                <div className="px-4 py-10 text-center text-gray-500">No available players match the current filters.</div>
              )}
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
              <div className="text-sm text-gray-600">{selectedTeamSlots.filledRequiredCount}/8 filled</div>
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
      )}

      {draftStatus === 'completed' && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          ✅ Draft complete — {picks.length} picks made.
        </div>
      )}

      {picks.length > 0 && (
        <section className="rounded-lg bg-white p-4 shadow">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Draft Summary
            <span className="ml-2 text-sm font-normal text-gray-500">{picks.length} picks</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100">
                  <th className="sticky left-0 z-10 bg-gray-100 px-2 py-1.5 text-left font-semibold text-gray-600 w-8">Rd</th>
                  {orderedTeams.map((team, idx) => (
                    <th key={team._id} className="min-w-[7rem] px-2 py-1.5 text-left font-semibold text-gray-700 whitespace-nowrap">
                      <span className="text-gray-400 mr-1">{idx + 1}.</span>{getTeamDisplayName(team)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: TOTAL_DRAFT_ROUNDS }, (_, i) => i + 1).map((round) => {
                  const isGrouped = round > STANDARD_SNAKE_ROUNDS;
                  return (
                    <tr key={round} className={isGrouped ? 'bg-amber-50' : round % 2 === 0 ? 'bg-gray-50' : ''}>
                      <td className={`sticky left-0 z-10 px-2 py-1 font-semibold ${
                        isGrouped ? 'bg-amber-50 text-amber-700' : round % 2 === 0 ? 'bg-gray-50 text-gray-500' : 'bg-white text-gray-500'
                      }`}>
                        {round}
                      </td>
                      {orderedTeams.map((team) => {
                        const p = picksByRoundAndTeam.get(round)?.get(team._id);
                        return (
                          <td key={team._id} className="px-2 py-1 align-top">
                            {p ? (
                              <div>
                                <div className="font-medium text-gray-900 truncate max-w-[7rem]" title={p.player.name}>
                                  {p.player.name}
                                </div>
                                <div className="text-gray-400">
                                  {p.player.eligible?.slice(0, 2).join('/') || '—'}
                                  {p.player.team ? ` · ${p.player.team}` : ''}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
