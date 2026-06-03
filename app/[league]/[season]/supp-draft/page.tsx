'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assignDraftSlots as _assignDraftSlots,
  getDraftEligiblePositions,
  getOwnerDisplay,
  getTeamDisplayName,
  DraftTeam,
} from '@/app/lib/draft-utils';
import {
  buildSuppDraftBoard,
  calculateSuppDraftRounds,
  isQuietTime,
  SuppDraftApiState,
  SuppDraftPlayer,
  MAX_DROP_INDICATIONS,
  SUPP_DRAFT_MIN_ROUNDS,
} from '@/app/lib/supp-draft-utils';
import { useLeagueSeason } from '@/app/lib/league-season-context';

type PlayerForSuppDraft = SuppDraftPlayer & {
  eligible: string[];
};

const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];
const GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem_6rem] sm:grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_6rem] md:grid-cols-[minmax(0,1.5fr)_3rem_3rem_3rem_3rem_3rem_3rem_3rem_4.5rem_6rem]';
const STAT_COLS = ['AB', 'H', '2B', '3B', 'HR', 'BB', 'SB'] as const;
const STAT_VIS = ['hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block', 'hidden md:block'] as const;
// Splits view grid: xs: Player | ABL | Action  sm: Player | ABL | L{N} | Action  md+: Player | ABL | L{N} | ABL On | ABL Off | Action
const SPLITS_GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem_6rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_6rem] md:grid-cols-[minmax(0,1.5fr)_5rem_6rem_6rem_6rem_6rem]';
const SPLIT_PERIODS = [7, 10, 14, 20, 30] as const;
interface SplitBucket { g: number; ab: number; abl: number | null; }
type SplitsData = Record<string, { lastN: Record<number, SplitBucket>; ablOn: SplitBucket; ablOff: SplitBucket }>;

function getAblStat(player: PlayerForSuppDraft): number {
  return player.abl ?? 0;
}

function getStatVal(player: PlayerForSuppDraft, col: typeof STAT_COLS[number]): number | null {
  const b = player.stats?.batting;
  if (!b) return null;
  const map: Record<string, number | null> = {
    AB: b.atBats ?? null,
    H: b.hits ?? null,
    '2B': b.doubles ?? null,
    '3B': b.triples ?? null,
    HR: b.homeRuns ?? null,
    BB: b.baseOnBalls ?? null,
    SB: b.stolenBases ?? null,
  };
  return map[col] ?? null;
}

function PlayerStatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">NR</span>;
  if (status.includes('Injured'))
    return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">INJ</span>;
  if (status.includes('Minors'))
    return <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">MIN</span>;
  return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">ACT</span>;
}

export default function SuppDraftPage() {
  const { league, season } = useLeagueSeason();

  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [players, setPlayers] = useState<PlayerForSuppDraft[]>([]);
  const [draft, setDraft] = useState<SuppDraftApiState | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userSub, setUserSub] = useState<string | null>(null);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [adminPickMode, setAdminPickMode] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [showPlayers, setShowPlayers] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  // Player list view: stats or splits
  const [playerListView, setPlayerListView] = useState<'stats' | 'splits'>('stats');
  const [splitPeriod, setSplitPeriod] = useState<number>(10);
  const [splitsData, setSplitsData] = useState<SplitsData | null>(null);
  const [splitsLoading, setSplitsLoading] = useState(false);
  // Drop indication state (for pending drafts)
  const [myRoster, setMyRoster] = useState<any[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  // Admin drop indication proxy
  const [adminDropTeamId, setAdminDropTeamId] = useState('');
  const [adminDropRoster, setAdminDropRoster] = useState<any[]>([]);
  const [loadingAdminRoster, setLoadingAdminRoster] = useState(false);
  // Skip loading indicator
  const [skippingTeamId, setSkippingTeamId] = useState<string | null>(null);
  const [autoPickFiring, setAutoPickFiring] = useState(false);
  // Live countdown display: seconds remaining until pickDeadlineAt (null = no deadline)
  const [pickSecondsLeft, setPickSecondsLeft] = useState<number | null>(null);
  const [pickTimerQuiet, setPickTimerQuiet] = useState(false);
  // Preview of who would be auto-picked right now
  const [autoPickPreview, setAutoPickPreview] = useState<{ playerName: string; positions: string[]; ablScore: number; fromQueue?: boolean } | null>(null);
  // Selected team's existing roster (for the slots widget)
  const [selectedTeamRoster, setSelectedTeamRoster] = useState<any[]>([]);
  const [loadingSelectedRoster, setLoadingSelectedRoster] = useState(false);
  // Queue management
  const [myQueue, setMyQueue] = useState<string[]>([]);
  const [autoDraftEnabled, setAutoDraftEnabled] = useState(false);
  const [savingQueue, setSavingQueue] = useState(false);
  const [savingAutoDraft, setSavingAutoDraft] = useState(false);
  const autoDraftFiringRef = useRef(false);

  const refreshDraft = useCallback(async () => {
    const qs = `?league=${league}&season=${season}`;
    const [draftRes, playersRes] = await Promise.all([
      fetch(`/api/supp-draft${qs}`, { cache: 'no-store' }),
      fetch(`/api/supp-draft/players${qs}`, { cache: 'no-store' }),
    ]);
    if (!draftRes.ok) throw new Error('Failed to load supp draft');
    const draftData = await draftRes.json();
    const playersData = playersRes.ok ? await playersRes.json() : [];
    setDraft(draftData.draft ?? null);
    setPlayers(
      (playersData as any[]).map((p: any) => ({
        ...p,
        eligible: getDraftEligiblePositions(p),
      }))
    );
  }, [league, season]);

  // Load user's roster for drop indication (only when pending)
  const loadMyRoster = useCallback(async (teamId: string) => {
    if (!teamId) return;
    setLoadingRoster(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/roster?league=${league}&season=${season}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      // Only show draft picks (can be indicated for drop)
      setMyRoster((data.roster ?? []).filter((r: any) => r.acqType === 'draft'));
    } finally {
      setLoadingRoster(false);
    }
  }, [league, season]);

  const loadAdminDropRoster = useCallback(async (teamId: string) => {
    if (!teamId) return;
    setLoadingAdminRoster(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/roster?league=${league}&season=${season}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setAdminDropRoster((data.roster ?? []).filter((r: any) => r.acqType === 'draft'));
    } finally {
      setLoadingAdminRoster(false);
    }
  }, [league, season]);

  useEffect(() => {
    if (adminDropTeamId) {
      loadAdminDropRoster(adminDropTeamId);
    }
  }, [adminDropTeamId, loadAdminDropRoster]);

  const loadSelectedTeamRoster = useCallback(async (teamId: string) => {
    if (!teamId) return;
    setLoadingSelectedRoster(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/roster?league=${league}&season=${season}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setSelectedTeamRoster(data.roster ?? []);
    } finally {
      setLoadingSelectedRoster(false);
    }
  }, [league, season]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = `?league=${league}&season=${season}`;
        const [teamsRes, adminRes, meRes, myLeaguesRes] = await Promise.all([
          fetch(`/api/teams${qs}`),
          fetch('/api/admin/me', { cache: 'no-store' }),
          fetch('/api/auth/me').catch(() => null),
          fetch('/api/auth/my-leagues').catch(() => null),
        ]);
        const teamsData: DraftTeam[] = teamsRes.ok ? await teamsRes.json() : [];
        const adminData = adminRes.ok ? await adminRes.json() : {};
        const meData = meRes?.ok ? await meRes.json() : {};
        const myLeaguesData = myLeaguesRes?.ok ? await myLeaguesRes.json() : [];

        setIsAdmin(Boolean(adminData?.isAdmin));
        setUserEmail(meData?.user?.email ?? null);
        setUserSub(meData?.user?.sub ?? null);

        // Find user's team in this season (same pattern as regular draft page)
        const myEntry = (Array.isArray(myLeaguesData) ? myLeaguesData : []).find(
          (e: any) => e.league?.slug === league && String(e.season?.year) === String(season)
        );
        const myTeamId = myEntry?.team?._id ?? null;
        setUserTeamId(myTeamId);

        const sortedTeams = [...teamsData].sort((a, b) =>
          getTeamDisplayName(a).localeCompare(getTeamDisplayName(b))
        );
        setTeams(sortedTeams);

        await refreshDraft();

        if (myTeamId) {
          await loadMyRoster(myTeamId);
        }

        if (sortedTeams.length > 0) setSelectedTeamId(sortedTeams[0]._id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load supp draft');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [league, season, refreshDraft, loadMyRoster]);

  // Poll while active
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (draft?.status !== 'active') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => refreshDraft().catch(() => {}), 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [draft?.status, refreshDraft]);

  // Countdown timer + auto-pick trigger
  const autoPickFiringRef = useRef(false);
  useEffect(() => {
    if (draft?.status !== 'active' || !draft.pickDeadlineAt) {
      setPickSecondsLeft(null);
      setPickTimerQuiet(false);
      return;
    }
    const deadline = new Date(draft.pickDeadlineAt);
    const tick = () => {
      const now = new Date();
      const quiet = isQuietTime(now);
      setPickTimerQuiet(quiet);
      const secsLeft = Math.ceil((deadline.getTime() - now.getTime()) / 1000);
      setPickSecondsLeft(secsLeft);

      // Trigger auto-pick when expired AND outside quiet hours AND not already firing
      if (secsLeft <= 0 && !quiet && !autoPickFiringRef.current) {
        autoPickFiringRef.current = true;
        setAutoPickFiring(true);
        fetch('/api/supp-draft/auto-pick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ league, season }),
        })
          .then(() => refreshDraft())
          .catch(() => {})
          .finally(() => {
            autoPickFiringRef.current = false;
            setAutoPickFiring(false);
          });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.pickDeadlineAt, draft?.status]);

  // Fetch auto-pick preview whenever the on-clock pick changes
  useEffect(() => {
    if (draft?.status !== 'active') { setAutoPickPreview(null); return; }
    let cancelled = false;
    fetch(`/api/supp-draft/auto-pick?league=${league}&season=${season}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data?.preview) setAutoPickPreview(data.preview); else if (!cancelled) setAutoPickPreview(null); })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.picks?.length, draft?.status]);

  // Load selected team's existing roster for the slots widget whenever they switch
  useEffect(() => {
    if (selectedTeamId && (draft?.status === 'active' || draft?.status === 'completed')) {
      loadSelectedTeamRoster(selectedTeamId);
    }
  }, [selectedTeamId, draft?.status, loadSelectedTeamRoster]);

  const orderedTeams = useMemo(() => {
    if (!draft) return [];
    const teamMap = new Map(teams.map((t) => [t._id, t]));
    return (draft.orderIds || []).map((id) => teamMap.get(id)).filter(Boolean) as DraftTeam[];
  }, [teams, draft]);

  const rounds = useMemo(() => {
    if (!draft) return 3;
    return draft.rounds;
  }, [draft]);

  // Per-team drop counts — must be before draftBoard so the board respects per-team limits
  const teamDropCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of draft?.dropIndications ?? []) {
      counts[d.teamId] = (counts[d.teamId] ?? 0) + 1;
    }
    return counts;
  }, [draft]);

  const draftBoard = useMemo(
    () => buildSuppDraftBoard(orderedTeams.map((t) => t._id), rounds, teamDropCounts),
    [orderedTeams, rounds, teamDropCounts]
  );

  const picks = draft?.picks ?? [];

  const filledSlotKeys = useMemo(() => {
    const s = new Set<string>();
    for (const p of picks) s.add(`${p.pick.teamId}:${p.pick.round}`);
    return s;
  }, [picks]);

  const skippedTeamIds = useMemo(() => new Set<string>(draft?.skippedTeams ?? []), [draft]);

  // Skip-aware current pick: honor any lock set when a team resumed, then fall back to
  // normal board-order (which will naturally jump back to the resumed team's earliest
  // missed slot once the locked slot is filled).
  const currentPick = useMemo(() => {
    if (draft?.status !== 'active') return null;
    const lockOverallPick = draft.lockedUntilOverallPick ?? null;
    if (lockOverallPick !== null) {
      const lockedSlot = draftBoard.find((slot) => slot.overallPick === lockOverallPick) ?? null;
      if (
        lockedSlot &&
        !filledSlotKeys.has(`${lockedSlot.teamId}:${lockedSlot.round}`) &&
        !skippedTeamIds.has(lockedSlot.teamId)
      ) {
        return lockedSlot;
      }
    }
    return (
      draftBoard.find(
        (slot) =>
          !filledSlotKeys.has(`${slot.teamId}:${slot.round}`) &&
          !skippedTeamIds.has(slot.teamId)
      ) ?? null
    );
  }, [draftBoard, filledSlotKeys, skippedTeamIds, draft?.status, draft?.lockedUntilOverallPick]);

  // Derived drop indications from draft state (avoids separate state)
  const myDropIndications = useMemo(
    () => (draft?.dropIndications ?? []).filter((d: any) => d.teamId === userTeamId),
    [draft, userTeamId]
  );
  const adminDropIndications = useMemo(
    () => (draft?.dropIndications ?? []).filter((d: any) => d.teamId === adminDropTeamId),
    [draft, adminDropTeamId]
  );
  const currentTeam = currentPick ? orderedTeams.find((t) => t._id === currentPick.teamId) ?? null : null;
  const pickedPlayerIds = useMemo(() => new Set(picks.map((p: any) => p.player._id)), [picks]);

  const isOnClock = useMemo(() => {
    if (!currentTeam) return false;
    if (userTeamId && currentTeam._id === userTeamId) return true;
    return (currentTeam.owners ?? []).some((o: any) =>
      (userSub && o.userId && o.userId === userSub) ||
      (userEmail && o.email && o.email.toLowerCase() === userEmail?.toLowerCase())
    );
  }, [currentTeam, userTeamId, userSub, userEmail]);

  const activeDraft = draft?.status === 'active';
  const pendingDraft = draft?.status === 'pending';
  const finalizedOrCompletedDraft = draft?.status === 'completed' || draft?.status === 'finalized';
  const canPick = activeDraft && !!currentPick && !!draft?.startedAt && (isOnClock || (isAdmin && adminPickMode));

  // Player filter/sort
  const filteredPlayers = useMemo(() => {
    return players
      .filter((p) => {
        if (pickedPlayerIds.has(p._id)) return false;
        if (activeOnly && p.status?.toLowerCase() !== 'active') return false;
        const matchSearch =
          !search.trim() ||
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.team ?? '').toLowerCase().includes(search.toLowerCase());
        const matchPos =
          positionFilter === 'ALL' || p.eligible.map((x) => x.toUpperCase()).includes(positionFilter);
        return matchSearch && matchPos;
      })
      .sort((a, b) => {
        // Splits-specific sort columns
        if (sortCol === 'splitL' || sortCol === 'splitOn' || sortCol === 'splitOff') {
          const nullVal = sortDir === 'desc' ? -Infinity : Infinity;
          const getSplitVal = (p: PlayerForSuppDraft) => {
            const mlbId = String(p.mlbID ?? '');
            const s = splitsData?.[mlbId];
            if (!s) return nullVal;
            if (sortCol === 'splitL')   return s.lastN?.[splitPeriod]?.abl ?? nullVal;
            if (sortCol === 'splitOn')  return s.ablOn?.abl ?? nullVal;
            return s.ablOff?.abl ?? nullVal;
          };
          const av = getSplitVal(a);
          const bv = getSplitVal(b);
          return sortDir === 'desc' ? bv - av : av - bv;
        }
        if (sortCol && sortCol !== 'abl') {
          const av = getStatVal(a, sortCol as typeof STAT_COLS[number]) ?? (sortDir === 'desc' ? -Infinity : Infinity);
          const bv = getStatVal(b, sortCol as typeof STAT_COLS[number]) ?? (sortDir === 'desc' ? -Infinity : Infinity);
          return sortDir === 'desc' ? bv - av : av - bv;
        }
        // Default splits sort: L{splitPeriod} ABL descending when no column selected
        if (!sortCol && playerListView === 'splits' && splitsData) {
          const aId = String(a.mlbID ?? '');
          const bId = String(b.mlbID ?? '');
          const av2 = splitsData[aId]?.lastN?.[splitPeriod]?.abl ?? -Infinity;
          const bv2 = splitsData[bId]?.lastN?.[splitPeriod]?.abl ?? -Infinity;
          if (av2 !== bv2) return bv2 - av2;
          return a.name.localeCompare(b.name);
        }
        const av = getAblStat(a);
        const bv = getAblStat(b);
        if (sortDir === 'asc' && sortCol === 'abl') return av - bv;
        if (av !== bv) return bv - av;
        return a.name.localeCompare(b.name);
      });
  }, [players, pickedPlayerIds, activeOnly, search, positionFilter, sortCol, sortDir, playerListView, splitsData, splitPeriod]);

  const selectedTeam = useMemo(
    () => orderedTeams.find((t) => t._id === selectedTeamId) ?? orderedTeams[0] ?? null,
    [orderedTeams, selectedTeamId]
  );

  const selectedTeamPicks = useMemo(
    () => picks.filter((p: any) => p.pick.teamId === selectedTeamId),
    [picks, selectedTeamId]
  );

  // Combined view: existing roster players + supp draft picks → used for slot widget
  // Only count 'draft' acqType (not pickups, which will be dropped as part of the draft process).
  // Also exclude drop-indicated players since they're leaving the roster.
  const dropIndicatedPlayerIdSet = useMemo(
    () => new Set((draft?.dropIndications ?? []).map((d: any) => d.playerId)),
    [draft]
  );

  const selectedTeamCombined = useMemo(() => {
    const rosterPlayers = selectedTeamRoster
      .filter((r: any) => r.acqType === 'draft' && !dropIndicatedPlayerIdSet.has(r.player?._id ?? r.player))
      .map((r: any) => ({
        _id: r.player?._id ?? '',
        name: r.player?.name ?? '?',
        eligible: (r.player?.eligible ?? getDraftEligiblePositions(r.player)) as string[],
        isSupp: false,
      }));
    const suppPlayers = selectedTeamPicks.map((p: any) => ({
      _id: p.player?._id ?? '',
      name: p.player?.name ?? '?',
      eligible: (p.player?.eligible ?? getDraftEligiblePositions(p.player)) as string[],
      isSupp: true,
    }));
    return [...rosterPlayers, ...suppPlayers];
  }, [selectedTeamRoster, selectedTeamPicks, dropIndicatedPlayerIdSet]);

  const selectedTeamPosCounts = useMemo(() => {
    const POS_ORDER = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];
    const counts: Record<string, number> = {};
    for (const p of selectedTeamCombined) {
      for (const pos of p.eligible) {
        const key = pos.toUpperCase();
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return POS_ORDER.filter((pos) => (counts[pos] ?? 0) > 0).map((pos) => ({ pos, count: counts[pos] }));
  }, [selectedTeamCombined]);

  // Lookup map for drop indication player names
  const selectedTeamPlayerMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of selectedTeamCombined) if (p._id) m.set(p._id, p.name);
    return m;
  }, [selectedTeamCombined]);

  const picksByRound = useMemo(() => {
    const map = new Map<number, Map<string, any>>();
    for (const p of picks) {
      const round = p.pick.round;
      if (!map.has(round)) map.set(round, new Map());
      map.get(round)!.set(p.pick.teamId, p);
    }
    return map;
  }, [picks]);
  const dropIndicatedIds = useMemo(
    () => new Set((draft?.dropIndications ?? []).map((d: any) => d.playerId)),
    [draft]
  );

  const handlePick = async (player: PlayerForSuppDraft) => {
    if (!canPick) return;
    try {
      setIsWorking(true);
      setError(null);
      const res = await fetch('/api/supp-draft/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: player._id, league, season }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to make pick');
      }
      await refreshDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to make pick');
    } finally {
      setIsWorking(false);
    }
  };

  const handleUndo = async () => {
    if (!isAdmin || !activeDraft) return;
    try {
      setIsWorking(true);
      setError(null);
      const res = await fetch('/api/supp-draft/picks', {
        method: 'DELETE',
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

  const handleDropIndicateForTeam = async (teamId: string, playerId: string) => {
    if (!teamId) return;
    try {
      setIsWorking(true);
      setError(null);
      const teamIndications = (draft?.dropIndications ?? []).filter((d: any) => d.teamId === teamId);
      const alreadyIndicated = teamIndications.some((d: any) => d.playerId === playerId);
      if (alreadyIndicated) {
        const res = await fetch('/api/supp-draft/drop-indicate', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ league, season, teamId, playerId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to remove drop indication');
        }
      } else {
        if (teamIndications.length >= MAX_DROP_INDICATIONS) {
          setError(`Maximum ${MAX_DROP_INDICATIONS} drop indications allowed per team.`);
          return;
        }
        const res = await fetch('/api/supp-draft/drop-indicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ league, season, teamId, playerId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to indicate drop');
        }
      }
      await refreshDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update drop indication');
    } finally {
      setIsWorking(false);
    }
  };

  // Shorthand for user's own team
  const handleDropIndicate = (playerId: string) => {
    if (userTeamId) handleDropIndicateForTeam(userTeamId, playerId);
  };

  const handleToggleSkip = async (teamId: string, skipped: boolean) => {
    try {
      setSkippingTeamId(teamId);
      setError(null);
      const res = await fetch('/api/supp-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, season, action: 'skip', teamId, skipped }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to update skip status');
      }
      await refreshDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update skip status');
    } finally {
      setSkippingTeamId(null);
    }
  };

  // Sync queue + auto-draft state from draft whenever draft/team changes
  useEffect(() => {
    if (!draft || !userTeamId) return;
    setMyQueue((draft.draftQueues?.[userTeamId] ?? []) as string[]);
    setAutoDraftEnabled((draft.autoDraftTeams ?? []).includes(userTeamId));
  }, [draft, userTeamId]);

  // When it's the user's turn and auto-draft is on, fire queue-pick immediately
  useEffect(() => {
    if (!isOnClock || !autoDraftEnabled || !activeDraft) return;
    if (autoDraftFiringRef.current) return;
    autoDraftFiringRef.current = true;
    (async () => {
      try {
        await fetch('/api/supp-draft/queue-pick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ league, season }),
        });
        await refreshDraft();
      } catch { /* silent */ } finally {
        autoDraftFiringRef.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnClock, autoDraftEnabled, activeDraft]);

  const handleSetQueue = async (newQueue: string[]) => {
    if (!userTeamId) return;
    setSavingQueue(true);
    try {
      const res = await fetch('/api/supp-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, season, action: 'set-queue', teamId: userTeamId, playerIds: newQueue }),
      });
      if (res.ok) {
        setMyQueue(newQueue);
        await refreshDraft();
      }
    } finally {
      setSavingQueue(false);
    }
  };

  const handleToggleAutoDraft = async () => {
    if (!userTeamId) return;
    const newEnabled = !autoDraftEnabled;
    setSavingAutoDraft(true);
    try {
      const res = await fetch('/api/supp-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, season, action: 'set-auto-draft', teamId: userTeamId, enabled: newEnabled }),
      });
      if (res.ok) {
        setAutoDraftEnabled(newEnabled);
        await refreshDraft();
      }
    } finally {
      setSavingAutoDraft(false);
    }
  };

  const sortIcon = (col: string) => {
    if (sortCol !== col) return <span className="ml-0.5 opacity-20">↕</span>;
    return <span className="ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  const handleSort = (col: string) => {
    if (sortCol !== col) { setSortCol(col); setSortDir('desc'); }
    else if (sortDir === 'desc') setSortDir('asc');
    else { setSortCol(null); setSortDir('desc'); }
  };

  // Fetch splits data whenever splits view is active and the player list changes
  useEffect(() => {
    if (playerListView !== 'splits') {
      setSplitsData(null);
      return;
    }
    if (players.length === 0) return;
    const mlbIds = players.map(p => String(p.mlbID ?? '')).filter(Boolean);
    if (mlbIds.length === 0) return;
    const ctrl = new AbortController();
    setSplitsLoading(true);
    fetch('/api/players/splits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mlbIds, days: [...SPLIT_PERIODS], league, season }),
      signal: ctrl.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error(`Splits fetch failed: ${r.status}`);
        return r.json();
      })
      .then(data => setSplitsData(data.splits ?? null))
      .catch(err => { if (err.name !== 'AbortError') console.error('Splits fetch:', err); })
      .finally(() => setSplitsLoading(false));
    return () => ctrl.abort();
  }, [players, playerListView, league, season]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-xl">Loading supp draft...</div>;
  }

  if (!draft) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-xl text-gray-600">No supplemental draft found for this season.</p>
        {isAdmin && (
          <Link
            href={`/admin/new-supp-draft?league=${league}&season=${season}`}
            className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
          >
            Set Up Supp Draft
          </Link>
        )}
      </div>
    );
  }

  const totalPicks = draftBoard.length;
  const filledPickCount = filledSlotKeys.size;
  const picksRemaining = Math.max(0, totalPicks - filledPickCount);
  const isDraftComplete = filledPickCount >= totalPicks;

  return (
    <div className="space-y-6 overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href={`/${league}/${season}`} className="mb-3 inline-block text-blue-600 hover:text-blue-800">
            ← Back to Home
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Supplemental Draft</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {league.toUpperCase()} {season} · {rounds} rounds · {filledPickCount}/{totalPicks} picks
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {draft.status !== 'pending' && (
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${
              draft.status === 'active' ? 'border-green-300 bg-green-50 text-green-700' :
              draft.status === 'completed' ? 'border-blue-300 bg-blue-50 text-blue-700' :
              draft.status === 'finalized' ? 'border-purple-300 bg-purple-50 text-purple-700' :
              'border-gray-300 bg-gray-50 text-gray-600'
            }`}>
              {draft.status}
            </span>
          )}
          {isAdmin && activeDraft && !isDraftComplete && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={isWorking || picks.length === 0}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Undo Pick
            </button>
          )}
          {isAdmin && activeDraft && (
            <button
              type="button"
              onClick={() => setAdminPickMode((v) => !v)}
              className={`rounded border px-3 py-1.5 text-xs font-semibold ${adminPickMode ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-300 bg-white text-gray-700'}`}
            >
              {adminPickMode ? 'Admin Pick: ON' : 'Admin Pick: OFF'}
            </button>
          )}
          {isAdmin && (
            <Link
              href={`/admin/new-supp-draft?league=${league}&season=${season}`}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Admin
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-red-700">dismiss</button>
        </div>
      )}

      {/* Team-owner "resume picks" banner when their team is skipped */}
      {!isAdmin && activeDraft && userTeamId && skippedTeamIds.has(userTeamId) && (
        <div className="flex items-center justify-between rounded border border-orange-300 bg-orange-50 px-4 py-3 text-sm">
          <span className="font-medium text-orange-800">Your team's picks are currently being skipped.</span>
          <button
            type="button"
            onClick={() => handleToggleSkip(userTeamId, false)}
            disabled={isWorking}
            className="rounded border border-orange-400 bg-white px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
          >
            Resume My Picks
          </button>
        </div>
      )}

      {/* Pending: Drop Indication UI */}
      {pendingDraft && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-amber-900">Pre-Draft Drop Window</h2>
            <p className="text-sm text-amber-700 mt-1">
              {draft.scheduledAt
                ? `Draft starts ${new Date(draft.scheduledAt).toLocaleString()}.`
                : 'Draft start time TBD.'}{' '}
              You can indicate up to {MAX_DROP_INDICATIONS} players from your roster to drop before the draft.
            </p>
          </div>

          {userTeamId && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-amber-800">
                Your drop indications ({myDropIndications.length}/{MAX_DROP_INDICATIONS}):
              </p>
              {myDropIndications.length === 0 && (
                <p className="text-sm text-amber-600 italic">None yet.</p>
              )}
              {myDropIndications.map((d) => {
                const r = myRoster.find((r: any) => (r.player?._id ?? r.player) === d.playerId);
                const p = r?.player;
                return (
                  <div key={d.playerId} className="flex items-center justify-between rounded border border-amber-300 bg-white px-3 py-2 text-sm gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{p?.name ?? d.playerId}</span>
                        <PlayerStatusBadge status={p?.status} />
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {p?.team ?? '—'} · {p?.eligible?.join('/') ?? p?.position ?? '—'}
                        {p?.abl != null && <span className="ml-2 font-mono text-gray-700">{p.abl.toFixed(2)} ABL</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDropIndicate(d.playerId)}
                      disabled={isWorking}
                      className="shrink-0 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {userTeamId && myDropIndications.length < MAX_DROP_INDICATIONS && myRoster.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-amber-800">Your drafted players — indicate up to {MAX_DROP_INDICATIONS} to drop:</p>
              {loadingRoster ? (
                <p className="text-sm text-amber-600">Loading roster...</p>
              ) : (
                <div className="rounded border border-gray-200 bg-white overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)_4rem_3rem_3.5rem_5rem] gap-x-2 border-b bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <div>#</div>
                    <div>Player</div>
                    <div className="text-center">Status</div>
                    <div className="text-center">Pos</div>
                    <div className="text-right">ABL</div>
                    <div></div>
                  </div>
                  {myRoster
                    .filter((r: any) => {
                      const pid = r.player?._id ?? r.player;
                      return !myDropIndications.some((d) => d.playerId === pid);
                    })
                    .map((r: any, idx: number) => {
                      const pid = r.player?._id ?? r.player;
                      const p = r.player;
                      return (
                        <div key={pid} className="grid grid-cols-[2rem_minmax(0,1fr)_4rem_3rem_3.5rem_5rem] gap-x-2 items-center border-b last:border-0 px-3 py-2 text-sm">
                          <div className="text-xs text-gray-400 font-mono">{r.rosterOrder ?? idx + 1}</div>
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 truncate">{p?.name ?? pid}</div>
                            <div className="text-xs text-gray-500 truncate">{p?.team ?? '—'}</div>
                          </div>
                          <div className="flex justify-center">
                            <PlayerStatusBadge status={p?.status} />
                          </div>
                          <div className="text-center text-xs text-gray-600">
                            {p?.eligible?.[0] ?? p?.position ?? '—'}
                          </div>
                          <div className="text-right font-mono text-xs text-gray-800">
                            {p?.abl != null ? p.abl.toFixed(2) : '—'}
                          </div>
                          <div className="text-right">
                            <button
                              type="button"
                              onClick={() => handleDropIndicate(pid)}
                              disabled={isWorking}
                              className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            >
                              Indicate
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {!userTeamId && (
            <p className="text-sm text-amber-600 italic">Sign in as a team owner to indicate drops.</p>
          )}

          {/* Admin: manage drop indications on behalf of any team */}
          {isAdmin && (
            <div className="border-t border-amber-200 pt-4 space-y-3">
              <p className="text-sm font-semibold text-amber-900">Admin: Manage Drop Indications</p>
              <select
                value={adminDropTeamId}
                onChange={(e) => setAdminDropTeamId(e.target.value)}
                className="w-full rounded border border-amber-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="">Select a team to manage...</option>
                {teams.map((team) => {
                  const count = (draft?.dropIndications ?? []).filter((d: any) => d.teamId === team._id).length;
                  return (
                    <option key={team._id} value={team._id}>
                      {getTeamDisplayName(team)} ({count}/{MAX_DROP_INDICATIONS})
                    </option>
                  );
                })}
              </select>
              {adminDropTeamId && (
                <>
                  {/* Current indications for selected team */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-amber-800">
                      Drop indications ({adminDropIndications.length}/{MAX_DROP_INDICATIONS}):
                    </p>
                    {adminDropIndications.length === 0 && (
                      <p className="text-xs text-amber-600 italic">None yet.</p>
                    )}
                    {adminDropIndications.map((d: any) => {
                      const r = adminDropRoster.find((r: any) => (r.player?._id ?? r.player) === d.playerId);
                      const p = r?.player;
                      return (
                        <div key={d.playerId} className="flex items-center justify-between rounded border border-amber-200 bg-white px-3 py-1.5 text-xs gap-2">
                          <div>
                            <span className="font-medium text-gray-800">{p?.name ?? d.playerId}</span>
                            {p && <span className="ml-2 text-gray-400">{p.team} · {p.eligible?.[0] ?? '—'}</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDropIndicateForTeam(adminDropTeamId, d.playerId)}
                            disabled={isWorking}
                            className="text-red-600 hover:text-red-800 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {/* Add indication for selected team */}
                  {adminDropIndications.length < MAX_DROP_INDICATIONS && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-amber-800">Add indication:</p>
                      {loadingAdminRoster ? (
                        <p className="text-xs text-amber-600">Loading roster...</p>
                      ) : adminDropRoster.length === 0 ? (
                        <p className="text-xs text-amber-600 italic">No draft picks on this team's roster.</p>
                      ) : (
                        <div className="rounded border border-gray-200 bg-white overflow-hidden">
                          {adminDropRoster
                            .filter((r: any) => !adminDropIndications.some((d: any) => d.playerId === (r.player?._id ?? r.player)))
                            .map((r: any, idx: number) => {
                              const pid = r.player?._id ?? r.player;
                              const p = r.player;
                              return (
                                <div key={pid} className="grid grid-cols-[1.5rem_minmax(0,1fr)_3rem_2.5rem_3rem_2rem] gap-x-2 items-center border-b last:border-0 px-3 py-1.5 text-xs">
                                  <span className="text-gray-400">{r.rosterOrder ?? idx + 1}</span>
                                  <div className="min-w-0">
                                    <span className="font-medium text-gray-800 truncate">{p?.name ?? pid}</span>
                                    <span className="ml-1.5 text-gray-400">{p?.team ?? ''}</span>
                                  </div>
                                  <div className="flex justify-center">
                                    <PlayerStatusBadge status={p?.status} />
                                  </div>
                                  <span className="text-center text-gray-500">{p?.eligible?.[0] ?? '—'}</span>
                                  <span className="text-right font-mono text-gray-600">
                                    {p?.abl != null ? p.abl.toFixed(1) : '—'}
                                  </span>
                                  <div className="text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleDropIndicateForTeam(adminDropTeamId, pid)}
                                      disabled={isWorking}
                                      className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Active/Completed Draft Main UI */}
      {(activeDraft || draft.status === 'completed') && (
        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          {/* Left panel: On Clock + Team selector */}
          <div className="space-y-4 rounded-lg bg-white p-4 shadow">
            {activeDraft && currentPick && currentTeam && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="text-sm font-semibold uppercase tracking-wide text-blue-700">On the clock</div>
                <div className="mt-2 text-xl font-bold text-gray-900">{getTeamDisplayName(currentTeam)}</div>
                <div className="mt-1 text-sm text-gray-600">{getOwnerDisplay(currentTeam)}</div>
                <div className="mt-2 text-sm text-gray-700">
                  Pick {currentPick.overallPick} · Round {currentPick.round}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {picksRemaining} pick{picksRemaining !== 1 ? 's' : ''} remaining
                </div>
                {/* Pick timer */}
                {pickSecondsLeft !== null && (
                  <div className={`mt-2 rounded px-2 py-1 text-xs font-mono font-semibold ${
                    pickTimerQuiet
                      ? 'bg-gray-100 text-gray-500'
                      : pickSecondsLeft <= 300
                      ? 'bg-red-100 text-red-700'
                      : pickSecondsLeft <= 1800
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {pickTimerQuiet ? (
                      '⏸ Paused (quiet hours 10pm–8am CT)'
                    ) : pickSecondsLeft <= 0 ? (
                      autoPickFiring ? '⚡ Auto-picking…' : '⏰ Time expired — picking…'
                    ) : (
                      (() => {
                        const h = Math.floor(pickSecondsLeft / 3600);
                        const m = Math.floor((pickSecondsLeft % 3600) / 60);
                        const s = pickSecondsLeft % 60;
                        return `⏱ ${h > 0 ? `${h}h ` : ''}${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
                      })()
                    )}
                  </div>
                )}
                {isOnClock && !adminPickMode && (
                  <div className="mt-2 rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
                    Your turn to pick!
                  </div>
                )}
                {/* Auto-pick preview */}
                {autoPickPreview && (
                  <div className="mt-3 border-t border-blue-200 pt-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-1">
                      Auto-pick would select {autoPickPreview.fromQueue ? '(from queue)' : '(from algorithm)'}
                    </div>
                    <div className="text-sm font-semibold text-gray-900">{autoPickPreview.playerName}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500">{autoPickPreview.positions.join(' / ')}</span>
                      <span className="text-xs font-mono text-gray-600">ABL {autoPickPreview.ablScore}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isDraftComplete && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
                <div className="text-lg font-bold text-green-800">Draft Complete!</div>
                {isAdmin && draft.status !== 'completed' && (
                  <p className="mt-1 text-sm text-green-700">
                    Go to Admin → Supp Draft to finalize rosters.
                  </p>
                )}
              </div>
            )}

            {/* Admin: skip controls per team */}
            {isAdmin && activeDraft && orderedTeams.length > 0 && (
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Skip Controls</div>
                <div className="space-y-1">
                  {orderedTeams.map((team) => {
                    const isSkipped = skippedTeamIds.has(team._id);
                    const isLoading = skippingTeamId === team._id;
                    return (
                      <div key={team._id} className="flex items-center justify-between text-xs">
                        <span className={isSkipped ? 'text-orange-600 line-through' : 'text-gray-800'}>
                          {getTeamDisplayName(team)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleSkip(team._id, !isSkipped)}
                          disabled={isWorking || isLoading}
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50 ${
                            isSkipped
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                          }`}
                        >
                          {isLoading ? '…' : isSkipped ? 'Resume' : 'Skip'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Queue + Auto-draft panel for the current user */}
            {activeDraft && userTeamId && (
              <div className="rounded-lg border border-gray-200 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">My Queue &amp; Auto-Draft</div>
                  <button
                    type="button"
                    onClick={handleToggleAutoDraft}
                    disabled={savingAutoDraft}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${autoDraftEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                    title={autoDraftEnabled ? 'Auto-draft ON — click to disable' : 'Auto-draft OFF — click to enable'}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${autoDraftEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 -mt-1">
                  {autoDraftEnabled
                    ? 'Auto-draft is ON — when it\'s your turn, the top of your queue (or the algorithm) picks automatically.'
                    : 'Auto-draft is OFF. Toggle to pick automatically when it\'s your turn.'}
                </p>
                {/* Queue list */}
                {myQueue.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No players queued. Add from the player list.</p>
                ) : (
                  <div className="space-y-1">
                    {myQueue.map((pid, idx) => {
                      const player = players.find((p) => p._id === pid);
                      const alreadyPicked = pickedPlayerIds.has(pid);
                      return (
                        <div key={pid} className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${alreadyPicked ? 'border-gray-200 bg-gray-50 opacity-50' : 'border-gray-200 bg-white'}`}>
                          <span className="w-4 text-center font-mono text-gray-400">{idx + 1}</span>
                          <span className="flex-1 min-w-0 truncate font-medium text-gray-800">
                            {player?.name ?? pid}
                            {alreadyPicked && <span className="ml-1 text-gray-400">(picked)</span>}
                          </span>
                          <span className="text-gray-400 text-[10px]">{player?.eligible?.join('/') ?? ''}</span>
                          <div className="flex items-center gap-0.5 ml-1">
                            <button
                              type="button"
                              disabled={savingQueue || idx === 0}
                              onClick={() => {
                                const q = [...myQueue];
                                [q[idx - 1], q[idx]] = [q[idx], q[idx - 1]];
                                handleSetQueue(q);
                              }}
                              className="rounded px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                              title="Move up"
                            >↑</button>
                            <button
                              type="button"
                              disabled={savingQueue || idx === myQueue.length - 1}
                              onClick={() => {
                                const q = [...myQueue];
                                [q[idx], q[idx + 1]] = [q[idx + 1], q[idx]];
                                handleSetQueue(q);
                              }}
                              className="rounded px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                              title="Move down"
                            >↓</button>
                            <button
                              type="button"
                              disabled={savingQueue}
                              onClick={() => handleSetQueue(myQueue.filter((_, i) => i !== idx))}
                              className="rounded px-1 text-red-400 hover:text-red-700 disabled:opacity-30"
                              title="Remove from queue"
                            >×</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Team selector + position slots */}
            <div>
              <select
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm"
              >
                {orderedTeams.map((team) => (
                  <option key={team._id} value={team._id}>
                    {getTeamDisplayName(team)}
                  </option>
                ))}
              </select>
              {selectedTeam && (
                <div className="text-xs text-gray-500 mt-1">{getOwnerDisplay(selectedTeam)}</div>
              )}
            </div>

            {/* Roster widget for selected team */}
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  Roster
                  {loadingSelectedRoster && <span className="ml-1.5 text-xs font-normal text-gray-400">loading…</span>}
                </h3>
                <div className="text-xs text-gray-500">{selectedTeamCombined.length} players</div>
              </div>
              {/* Position counts */}
              {selectedTeamPosCounts.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedTeamPosCounts.map(({ pos, count }) => (
                    <span key={pos} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                      {pos}: {count}
                    </span>
                  ))}
                </div>
              )}
              {/* Player list */}
              <div className="max-h-64 overflow-y-auto space-y-0.5">
                {selectedTeamCombined.length === 0 && !loadingSelectedRoster && (
                  <p className="text-xs text-gray-400 italic">No players.</p>
                )}
                {selectedTeamCombined.map((p, idx) => (
                  <div key={p._id || idx} className="flex items-center gap-1.5 text-xs">
                    <span className="truncate text-gray-800 flex-1">{p.name}</span>
                    <span className="shrink-0 text-gray-400">{p.eligible.join('/')}</span>
                    {p.isSupp && (
                      <span className="shrink-0 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-semibold text-blue-600">NEW</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Drop indications for selected team */}
            {draft.dropIndications?.filter((d: any) => d.teamId === selectedTeamId).length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-xs font-semibold text-amber-700 mb-1">Indicated for drop</div>
                {draft.dropIndications
                  .filter((d: any) => d.teamId === selectedTeamId)
                  .map((d: any) => (
                    <div key={d.playerId} className="text-xs text-amber-800">
                      {selectedTeamPlayerMap.get(d.playerId) ?? d.playerId}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Right panel: Player list */}
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-base font-semibold text-gray-900">Available Players</h2>
              <button
                type="button"
                onClick={() => setShowPlayers((v) => !v)}
                className="text-xs text-gray-500 hover:text-gray-800"
              >
                {showPlayers ? 'Hide' : 'Show'} player list
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="Search player or team..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm w-48"
              />
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="ALL">All Positions</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                  className="rounded"
                />
                Active only
              </label>
            </div>

            {/* Stats / Splits tabs */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setPlayerListView('stats'); setSortCol(null); setSortDir('desc'); }}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${playerListView === 'stats' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                Stats
              </button>
              <button
                type="button"
                onClick={() => { setPlayerListView('splits'); setSortCol(null); setSortDir('desc'); }}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${playerListView === 'splits' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                Splits
              </button>
              {playerListView === 'splits' && (
                <select
                  value={splitPeriod}
                  onChange={e => setSplitPeriod(Number(e.target.value))}
                  className="rounded border border-gray-300 px-2 py-1.5 text-xs"
                >
                  {SPLIT_PERIODS.map(n => (
                    <option key={n} value={n}>Last {n} days</option>
                  ))}
                </select>
              )}
              {playerListView === 'splits' && splitsLoading && (
                <span className="text-xs text-blue-500 animate-pulse">Loading splits…</span>
              )}
            </div>

            {showPlayers && (
              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                {/* Header row */}
                {playerListView === 'stats' ? (
                  <div className={`${GRID} gap-x-2 border-b bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500`}>
                    <div>Player</div>
                    {STAT_COLS.map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => handleSort(col)}
                        className={`text-right hidden md:block hover:text-gray-800`}
                      >
                        {col}{sortIcon(col)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleSort('abl')}
                      className="text-right hover:text-gray-800"
                    >
                      ABL{sortIcon('abl')}
                    </button>
                    <div className="text-right">Action</div>
                  </div>
                ) : (
                  <div className={`${SPLITS_GRID} gap-x-2 border-b bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500`}>
                    <div>Player</div>
                    <button
                      type="button"
                      onClick={() => handleSort('abl')}
                      className="text-center text-green-700 hover:opacity-80"
                    >
                      ABL{sortIcon('abl')}
                      <div className="text-[10px] font-normal normal-case text-gray-400 leading-tight">season</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSort('splitL')}
                      className="text-center hover:opacity-80 hidden sm:block"
                    >
                      L{splitPeriod}{sortIcon('splitL')}
                      <div className="text-[10px] font-normal normal-case text-gray-400 leading-tight">G/AB</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSort('splitOn')}
                      className="text-center text-blue-600 hover:opacity-80 hidden md:block"
                    >
                      ABL On{sortIcon('splitOn')}
                      <div className="text-[10px] font-normal normal-case text-gray-400 leading-tight">G/AB</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSort('splitOff')}
                      className="text-center text-orange-600 hover:opacity-80 hidden md:block"
                    >
                      ABL Off{sortIcon('splitOff')}
                      <div className="text-[10px] font-normal normal-case text-gray-400 leading-tight">G/AB</div>
                    </button>
                    <div className="text-right">Action</div>
                  </div>
                )}

                {/* Player rows */}
                <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                  {filteredPlayers.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-gray-500">No available players found.</div>
                  )}
                  {filteredPlayers.map((player) => {
                    const isPickup = !!player.onRosterTeamId && player.onRosterAcqType === 'pickup';
                    const isDropIndicated = player.isDropIndicated;
                    const mlbId = String(player.mlbID ?? '');
                    const ps = splitsData?.[mlbId];
                    const renderBucket = (bucket: SplitBucket | undefined) => {
                      if (splitsLoading) return <div className="text-center text-xs text-gray-300">…</div>;
                      if (!bucket) return <div className="text-center text-xs text-gray-300">—</div>;
                      const ablColor = bucket.abl == null ? 'text-gray-400' : bucket.abl >= 0 ? 'text-green-700' : 'text-red-500';
                      return (
                        <div className="text-center">
                          <div className={`text-xs font-medium ${ablColor}`}>{bucket.abl != null ? bucket.abl.toFixed(2) : '—'}</div>
                          <div className="text-[10px] text-gray-400 leading-tight">{bucket.g}/{bucket.ab}</div>
                        </div>
                      );
                    };
                    const actionCell = (
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canPick && (
                            <button
                              type="button"
                              onClick={() => handlePick(player)}
                              disabled={isWorking}
                              className="rounded bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Pick
                            </button>
                          )}
                          {activeDraft && userTeamId && !myQueue.includes(player._id) && (
                            <button
                              type="button"
                              onClick={() => handleSetQueue([...myQueue, player._id])}
                              disabled={savingQueue}
                              className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                              title="Add to my queue"
                            >
                              +Q
                            </button>
                          )}
                        </div>
                      </div>
                    );
                    return (
                      <div
                        key={player._id}
                        className={`${playerListView === 'splits' ? SPLITS_GRID : GRID} gap-x-2 items-center px-3 py-2 text-sm hover:bg-gray-50 ${isDropIndicated ? 'bg-amber-50' : ''}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-gray-900 truncate">{player.name}</span>
                            <span className="text-xs text-gray-500">
                              {player.eligible.join('/')} · {player.team ?? '—'}
                            </span>
                            {isPickup && (
                              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                                Pickup
                              </span>
                            )}
                            {isDropIndicated && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                Drop Indicated
                              </span>
                            )}
                          </div>
                        </div>
                        {playerListView === 'stats' ? (
                          <>
                            {STAT_COLS.map((col) => (
                              <div key={col} className="hidden md:block text-right text-gray-600 tabular-nums text-xs">
                                {getStatVal(player, col) ?? '—'}
                              </div>
                            ))}
                            <div className="text-right font-mono text-xs text-gray-800">
                              {getAblStat(player).toFixed(2)}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className={`text-center text-xs font-medium ${player.abl != null ? (player.abl >= 0 ? 'text-green-700' : 'text-red-500') : 'text-gray-400'}`}>
                              {player.abl != null ? player.abl.toFixed(2) : '—'}
                            </div>
                            <div className="hidden sm:block">
                              {renderBucket(ps?.lastN?.[splitPeriod])}
                            </div>
                            <div className="hidden md:block">
                              {renderBucket(ps?.ablOn)}
                            </div>
                            <div className="hidden md:block">
                              {renderBucket(ps?.ablOff)}
                            </div>
                          </>
                        )}
                        {actionCell}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Draft board by round */}
      {(activeDraft || finalizedOrCompletedDraft) && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">Draft Board</h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Round</th>
                  {orderedTeams.map((team) => (
                    <th
                      key={team._id}
                      className={`px-2 py-2 text-left font-semibold whitespace-nowrap ${skippedTeamIds.has(team._id) ? 'text-orange-500' : 'text-gray-600'}`}
                    >
                      {getTeamDisplayName(team)}
                      {skippedTeamIds.has(team._id) && (
                        <span className="ml-1 text-[9px] font-normal text-orange-400">(skip)</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => {
                  const roundPicks = picksByRound.get(round);
                  return (
                    <tr key={round} className="border-b last:border-0">
                      <td className="px-3 py-2 font-semibold text-gray-500">{round}</td>
                      {orderedTeams.map((team) => {
                        const pick = roundPicks?.get(team._id);
                        const isCurrent =
                          currentPick?.round === round && currentPick?.teamId === team._id;
                        const teamLimit = SUPP_DRAFT_MIN_ROUNDS + (teamDropCounts[team._id] ?? 0);
                        const isIneligible = round > teamLimit;
                        return (
                          <td
                            key={team._id}
                            className={`px-2 py-2 whitespace-nowrap ${
                              isIneligible
                                ? 'bg-gray-50 text-gray-300'
                                : isCurrent
                                ? 'bg-blue-50 font-semibold text-gray-700'
                                : 'text-gray-700'
                            }`}
                          >
                            {isIneligible ? (
                              <span className="text-gray-300">n/a</span>
                            ) : pick ? (
                              <span className="text-gray-900">{pick.player.name}</span>
                            ) : isCurrent ? (
                              <span className="text-blue-600 animate-pulse">On clock…</span>
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

      {/* Draft order (shown in pending state) */}
      {pendingDraft && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">Draft Order</h2>
          <div className="rounded-lg border border-gray-200 bg-white divide-y">
            {orderedTeams.map((team, idx) => (
              <div key={team._id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 text-center font-bold text-gray-400 text-sm">{idx + 1}</span>
                <div>
                  <div className="font-medium text-gray-900 text-sm">{getTeamDisplayName(team)}</div>
                  <div className="text-xs text-gray-500">{getOwnerDisplay(team)}</div>
                </div>
                {dropIndicatedIds.size > 0 && (
                  <div className="ml-auto text-xs text-amber-700">
                    {draft.dropIndications?.filter((d: any) => d.teamId === team._id).length ?? 0} drop{(draft.dropIndications?.filter((d: any) => d.teamId === team._id).length ?? 0) !== 1 ? 's' : ''} indicated
                  </div>
                )}
              </div>
            ))}
          </div>
          {isAdmin && (
            <p className="text-sm text-gray-500">
              Start the draft from the{' '}
              <Link
                href={`/admin/new-supp-draft?league=${league}&season=${season}`}
                className="text-blue-600 hover:text-blue-800 underline"
              >
                admin panel
              </Link>.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
