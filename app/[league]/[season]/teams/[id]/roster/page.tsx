'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useLeagueSeason } from '@/app/lib/league-season-context';

type PosEntry = { pos: string; ct: number };
type PosLogData = { positionsLog: PosEntry[]; eligiblePositions: string[]; abl: number | null };

const ELIGIBILITY_THRESHOLD = 10;
const STANDARD_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'OF', 'DH'] as const;

interface Player {
  _id: string;
  name: string;
  mlbID: string;
  team: string;
  position?: string;
  eligible?: string[];
  status?: string;
  ablstatus?: {
    ablTeam: string;
    acqType: 'draft' | 'supp_draft' | 'fa' | 'trade';
    onRoster: boolean;
  };
  stats?: any;
  abl_runs?: number;
  abl?: number;
}

interface RosterItem {
  player: Player;
  lineupPosition: string | null;
  rosterOrder: number;
  acqType?: 'draft' | 'supp_draft' | 'fa' | 'trade';
}

interface RosterData {
  _id?: string;
  ablTeam: string;
  effectiveDate: string;
  lockTime: string;
  roster: RosterItem[];
  updatedAt: string;
  locked: boolean;
  timeUntilLock: number | null;
  nextGameDate?: string;
  nextGame?: {
    _id: string;
    gameDate: string;
    homeTeam: any;
    awayTeam: any;
  };
  asOf?: string | null;
}

function getStarterSet(items: RosterItem[]): Set<number> {
  const starters = new Set<number>();
  const filledInfield = { C: false, '1B': false, '2B': false, '3B': false, SS: false };
  let ofCount = 0;
  let dhFilled = false;
  const isActive = (pos: string | null) => !!pos && pos !== 'INJ' && pos !== 'NA' && pos !== 'NR';

  for (let i = 0; i < items.length; i++) {
    const pos = items[i].lineupPosition;
    if (!isActive(pos)) continue;
    if (pos === 'DH' && !dhFilled) { starters.add(i); dhFilled = true; }
    else if (pos === 'OF' && ofCount < 3) { starters.add(i); ofCount++; }
    else if (pos && pos in filledInfield && !filledInfield[pos as keyof typeof filledInfield]) {
      starters.add(i);
      filledInfield[pos as keyof typeof filledInfield] = true;
    }
  }
  // Implied DH: first active player not already filling a slot
  if (!dhFilled) {
    for (let i = 0; i < items.length; i++) {
      if (!starters.has(i) && isActive(items[i].lineupPosition)) { starters.add(i); break; }
    }
  }
  return starters;
}

export default function TeamRosterPage({ embedded = false }: { embedded?: boolean }) {
  const params = useParams();
  const teamId = params.id as string;
  const { league, season } = useLeagueSeason();

  const [roster, setRoster] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [seasonStatus, setSeasonStatus] = useState<string | null>(null);
  const [teamOwners, setTeamOwners] = useState<any[]>([]);
  const [teamInfo, setTeamInfo] = useState<{ location: string; nickname: string; stadium: string }>({ location: '', nickname: '', stadium: '' });
  const [editingTeamInfo, setEditingTeamInfo] = useState(false);
  const [teamInfoDraft, setTeamInfoDraft] = useState<{ location: string; nickname: string; stadium: string }>({ location: '', nickname: '', stadium: '' });
  const [savingTeamInfo, setSavingTeamInfo] = useState(false);
  const [teamInfoError, setTeamInfoError] = useState('');
  const [showCoOwnerModal, setShowCoOwnerModal] = useState(false);
  const [allUsers, setAllUsers] = useState<{ userId: string; name: string }[]>([]);
  const [coOwnerSearch, setCoOwnerSearch] = useState('');
  const [addingCoOwner, setAddingCoOwner] = useState(false);
  const [removingCoOwner, setRemovingCoOwner] = useState<string | null>(null);
  const [coOwnerError, setCoOwnerError] = useState('');
  const [showRulesPopover, setShowRulesPopover] = useState(false);
  const [asOfDate, setAsOfDate] = useState('');
  const [rosterView, setRosterView] = useState<'stats' | 'eligibility' | 'splits'>('stats');
  const [posLogs, setPosLogs] = useState<Map<string, PosLogData>>(new Map());
  const [posLogsLoading, setPosLogsLoading] = useState(false);

  // Splits state
  const SPLIT_PERIODS_ROSTER = [7, 10, 14, 20, 30] as const;
  interface SplitBucketR { g: number; ab: number; abl: number | null; }
  type SplitsDataR = Record<string, { lastN: Record<number, SplitBucketR>; ablOn: SplitBucketR; ablOff: SplitBucketR }>;
  const [splitPeriod, setSplitPeriod] = useState<number>(10);
  const [splitsData, setSplitsData] = useState<SplitsDataR | null>(null);
  const [splitsLoading, setSplitsLoading] = useState(false);

  useEffect(() => {
    fetchUserAndRoster();
  }, [teamId]);

  const fetchUserAndRoster = async () => {
    try {
      setLoading(true);

      const [userRes, adminRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/admin/me'),
      ]);
      if (userRes.ok) {
        const userData = await userRes.json();
        setCurrentUser(userData?.user);

        const teamRes = await fetch(`/api/teams/${teamId}`);
        if (teamRes.ok) {
          const team = await teamRes.json();
          const userOwnsTeam = team.owners?.some((o: any) => o.userId === userData?.user?.sub);
          setIsOwner(userOwnsTeam || false);
          setTeamOwners(team.owners ?? []);
          const info = { location: team.location ?? '', nickname: team.nickname ?? '', stadium: team.stadium ?? '' };
          setTeamInfo(info);
          setTeamInfoDraft(info);
        }
      }
      if (adminRes.ok) {
        const adminData = await adminRes.json();
        setIsAdmin(adminData?.isAdmin || false);
      }

      // Fetch season status to gate pre-draft actions
      const seasonRes = await fetch(`/api/seasons?league=${league}&year=${season}`).then(r => r.json()).catch(() => []);
      const seasonData = Array.isArray(seasonRes) ? seasonRes[0] : null;
      setSeasonStatus(seasonData?.status ?? null);

      const rosterRes = await fetch(`/api/teams/${teamId}/roster`);
      if (!rosterRes.ok) throw new Error('Failed to fetch roster');
      const data = await rosterRes.json();
      setRoster(data);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoster = async (date?: string) => {
    try {
      setLoading(true);
      const url = date
        ? `/api/teams/${teamId}/roster?asOf=${encodeURIComponent(date)}`
        : `/api/teams/${teamId}/roster`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch roster');
      const data = await res.json();
      setRoster(data);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleAsOfDateChange = (date: string) => {
    setAsOfDate(date);
    fetchRoster(date || undefined);
  };

  const posLogsRef = useRef<Map<string, PosLogData>>(new Map());

  const fetchPosLogs = useCallback(async (rosterItems: RosterItem[]) => {
    const needed = rosterItems.filter(item => !posLogsRef.current.has(item.player.mlbID) && item.player.mlbID);
    if (needed.length === 0) return;
    setPosLogsLoading(true);
    try {
      const results = await Promise.all(
        needed.map(async item => {
          const res = await fetch(`/api/players/${item.player.mlbID}/position-log`);
          const data: PosLogData = res.ok ? await res.json() : { positionsLog: [], eligiblePositions: [], abl: null };
          return { mlbID: item.player.mlbID, data };
        })
      );
      setPosLogs(prev => {
        const next = new Map(prev);
        results.forEach(({ mlbID, data }) => {
          next.set(mlbID, data);
          posLogsRef.current.set(mlbID, data);
        });
        return next;
      });
    } finally {
      setPosLogsLoading(false);
    }
  }, []);

  const handleViewChange = (view: 'stats' | 'eligibility' | 'splits') => {
    setRosterView(view);
    if (view === 'eligibility' && roster) {
      fetchPosLogs(roster.roster);
    }
    if (view === 'splits' && roster) {
      const mlbIds = roster.roster
        .map(item => String(item.player.mlbID ?? ''))
        .filter(Boolean);
      if (mlbIds.length === 0) return;
      setSplitsLoading(true);
      setSplitsData(null);
      fetch('/api/players/splits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mlbIds, days: [...SPLIT_PERIODS_ROSTER], league, season }),
      })
        .then(r => r.json())
        .then(data => setSplitsData(data.splits ?? null))
        .catch(err => console.error('Splits fetch:', err))
        .finally(() => setSplitsLoading(false));
    }
  };

  const handleDragStart = (index: number) => {
    if (roster?.locked || (!isOwner && !isAdmin)) return;
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragPointerYRef.current = e.clientY;
    if (draggedIndex === null || draggedIndex === index || !roster || roster.locked || (!isOwner && !isAdmin)) return;

    const items = [...roster.roster];
    const draggedItem = items[draggedIndex];
    const targetItem = items[index];

    const isDraggedPickup =
      draggedItem.acqType === 'fa' ||
      draggedItem.acqType === 'trade';
    const isTargetDrafted =
      targetItem.acqType === 'draft' ||
      targetItem.acqType === 'supp_draft';

    if (isDraggedPickup && isTargetDrafted && index < draggedIndex) return;

    items.splice(draggedIndex, 1);
    items.splice(index, 0, draggedItem);
    items.forEach((item, idx) => { item.rosterOrder = idx + 1; });

    setRoster({ ...roster, roster: items });
    setDraggedIndex(index);
    setHasChanges(true);
  };

  const handleDragEnd = () => { setDraggedIndex(null); };

  const handleMoveUp = (index: number) => {
    if (index === 0 || !roster || roster.locked || (!isOwner && !isAdmin)) return;
    const items = [...roster.roster];
    const moving = items[index];
    const above = items[index - 1];
    const isMovingPickup = moving.acqType === 'fa' || moving.acqType === 'trade';
    const isAboveDrafted = above.acqType === 'draft' || above.acqType === 'supp_draft';
    if (isMovingPickup && isAboveDrafted) return;
    [items[index - 1], items[index]] = [items[index], items[index - 1]];
    items.forEach((item, idx) => { item.rosterOrder = idx + 1; });
    setRoster({ ...roster, roster: items });
    setHasChanges(true);
  };

  const handleMoveDown = (index: number) => {
    if (!roster || index >= roster.roster.length - 1 || roster.locked || (!isOwner && !isAdmin)) return;
    const items = [...roster.roster];
    const moving = items[index];
    const below = items[index + 1];
    const isMovingDrafted = moving.acqType === 'draft' || moving.acqType === 'supp_draft';
    const isBelowPickup = below.acqType === 'fa' || below.acqType === 'trade';
    if (isMovingDrafted && isBelowPickup) return;
    [items[index], items[index + 1]] = [items[index + 1], items[index]];
    items.forEach((item, idx) => { item.rosterOrder = idx + 1; });
    setRoster({ ...roster, roster: items });
    setHasChanges(true);
  };

  // Refs so native (non-passive) touch handlers always see fresh state without stale closures
  const rosterRef = useRef<RosterData | null>(null);
  const draggedIndexRef = useRef<number | null>(null);
  const isOwnerRef = useRef(false);
  const canEditRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Auto-scroll while dragging near the top/bottom edges of the viewport
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);

  useEffect(() => { rosterRef.current = roster; }, [roster]);
  useEffect(() => { isOwnerRef.current = isOwner; }, [isOwner]);
  useEffect(() => { canEditRef.current = isOwner || isAdmin; }, [isOwner, isAdmin]);
  useEffect(() => { draggedIndexRef.current = draggedIndex; }, [draggedIndex]);

  const AUTOSCROLL_EDGE = 60;
  const AUTOSCROLL_MAX_SPEED = 18;

  const runAutoScroll = useCallback(() => {
    const y = dragPointerYRef.current;
    if (y !== null && draggedIndexRef.current !== null) {
      const topEdge = theadRef.current?.getBoundingClientRect().bottom ?? 0;
      const bottomEdge = window.innerHeight;

      let delta = 0;
      if (y < topEdge + AUTOSCROLL_EDGE) {
        const intensity = Math.min(1, (topEdge + AUTOSCROLL_EDGE - y) / AUTOSCROLL_EDGE);
        delta = -intensity * AUTOSCROLL_MAX_SPEED;
      } else if (y > bottomEdge - AUTOSCROLL_EDGE) {
        const intensity = Math.min(1, (y - (bottomEdge - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE);
        delta = intensity * AUTOSCROLL_MAX_SPEED;
      }
      if (delta !== 0) {
        window.scrollBy(0, delta);
      }
    }
    autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
  }, []);

  useEffect(() => {
    if (draggedIndex !== null) {
      autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
    }
    return () => {
      if (autoScrollFrameRef.current !== null) {
        cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
      dragPointerYRef.current = null;
    };
  }, [draggedIndex, runAutoScroll]);

  // Native HTML5 drag doesn't fire onDragOver on rows when hovering above the
  // first row (e.g. over the sticky header) or below the last row, so track
  // the pointer position globally to keep auto-scroll working there too.
  useEffect(() => {
    const onDocDragOver = (e: DragEvent) => {
      if (draggedIndexRef.current !== null) {
        dragPointerYRef.current = e.clientY;
      }
    };
    document.addEventListener('dragover', onDocDragOver);
    return () => document.removeEventListener('dragover', onDocDragOver);
  }, []);

  // React registers onTouchMove as passive (cannot call preventDefault), so iOS Safari
  // intercepts the gesture for scrolling before our handler can reorder rows.
  // Solution: attach non-passive native listeners to document so preventDefault works.
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      const handle = (e.target as Element).closest('[data-drag-handle]') as HTMLElement | null;
      if (!handle) return;
      if (!canEditRef.current || rosterRef.current?.locked) return;
      const rowEl = handle.closest('tr[data-index]') as HTMLElement | null;
      if (!rowEl) return;
      const index = parseInt(rowEl.dataset.index ?? '-1', 10);
      if (isNaN(index) || index < 0) return;
      const touch = e.touches[0];
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
      // Prevent iOS from claiming this touch for scroll
      e.preventDefault();
      longPressTimerRef.current = setTimeout(() => {
        draggedIndexRef.current = index;
        setDraggedIndex(index);
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(50);
        }
      }, 300);
    };

    const onTouchMove = (e: TouchEvent) => {
      // Cancel long-press if finger moved significantly before it fired
      if (longPressTimerRef.current !== null && touchStartPosRef.current) {
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartPosRef.current.x;
        const dy = touch.clientY - touchStartPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 15) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          touchStartPosRef.current = null;
        }
      }
      const currentDraggedIndex = draggedIndexRef.current;
      if (currentDraggedIndex === null) return;
      // Prevent iOS scroll during active drag
      e.preventDefault();
      const currentRoster = rosterRef.current;
      if (!currentRoster || currentRoster.locked || !canEditRef.current) return;
      const touch = e.touches[0];
      dragPointerYRef.current = touch.clientY;
      const elem = document.elementFromPoint(touch.clientX, touch.clientY);
      const row = elem?.closest('tr[data-index]') as HTMLElement | null;
      if (!row) return;
      const targetIndex = parseInt(row.dataset.index ?? '-1', 10);
      if (isNaN(targetIndex) || targetIndex < 0 || targetIndex === currentDraggedIndex) return;
      const items = [...currentRoster.roster];
      const draggedItem = items[currentDraggedIndex];
      const targetItem = items[targetIndex];
      const isDraggedPickup =
        draggedItem.acqType === 'fa' ||
        draggedItem.acqType === 'trade';
      const isTargetDrafted =
        targetItem.acqType === 'draft' ||
        targetItem.acqType === 'supp_draft';
      if (isDraggedPickup && isTargetDrafted && targetIndex < currentDraggedIndex) return;
      items.splice(currentDraggedIndex, 1);
      items.splice(targetIndex, 0, draggedItem);
      items.forEach((item, idx) => { item.rosterOrder = idx + 1; });
      const newRoster = { ...currentRoster, roster: items };
      // Update refs immediately so the next touchmove sees fresh values
      rosterRef.current = newRoster;
      draggedIndexRef.current = targetIndex;
      setRoster(newRoster);
      setDraggedIndex(targetIndex);
      setHasChanges(true);
    };

    const onTouchEnd = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      touchStartPosRef.current = null;
      draggedIndexRef.current = null;
      setDraggedIndex(null);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const handlePositionChange = (index: number, newPosition: string) => {
    if (!roster || roster.locked || (!isOwner && !isAdmin)) return;
    const items = [...roster.roster];
    items[index].lineupPosition = newPosition;
    setRoster({ ...roster, roster: items });
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!roster || !hasChanges) return;
    try {
      setSaving(true);
      const res = await fetch(`/api/teams/${teamId}/roster`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roster: roster.roster }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save roster');
      }
      await fetchRoster();
      alert('Roster saved successfully!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save roster');
    } finally {
      setSaving(false);
    }
  };

  const handleDropPlayer = async (playerId: string, playerName: string, acqType: string) => {
    if (!isOwner && !isAdmin) { alert('Only the team owner or an admin can modify the roster'); return; }
    if (roster?.locked) { alert('Roster is locked for next game'); return; }
    if (acqType === 'draft' || acqType === 'supp_draft') { alert('Cannot drop drafted players'); return; }
    if (!confirm(`Drop ${playerName}?`)) return;

    try {
      const res = await fetch(`/api/teams/${teamId}/roster/${playerId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to drop player');
      }
      await fetchRoster();
      alert('Player dropped successfully!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to drop player');
    }
  };

  const formatTimeRemaining = (ms: number | null) => {
    if (ms === null) return '';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-xl">Loading roster...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  if (!roster) return null;

  const ROSTER_LIMIT = 24; // increases to 27 after Supplemental Draft

  const draftedPlayers = roster.roster.filter(
    r => r.acqType === 'draft' || r.acqType === 'supp_draft'
  );
  const pickupPlayers = roster.roster.filter(
    r => r.acqType === 'fa' || r.acqType === 'trade'
  );
  const activePlayers = roster.roster.filter(
    r => r.lineupPosition !== 'INJ' && r.lineupPosition !== 'NA' && r.lineupPosition !== 'NR'
  );
  const rosterAtCapacity = activePlayers.length >= ROSTER_LIMIT;

  return (
    <div className={embedded ? 'w-full' : 'container mx-auto px-4 py-8'}>
      <div className="mb-8">
        {!embedded && (
          <Link href={`/${league}/${season}`} className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
            ← Back to Home
          </Link>
        )}

        {!embedded && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
          {editingTeamInfo ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">City / Location</label>
                  <input
                    type="text"
                    value={teamInfoDraft.location}
                    onChange={(e) => setTeamInfoDraft(d => ({ ...d, location: e.target.value }))}
                    placeholder="e.g. New York"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">Team Nickname</label>
                  <input
                    type="text"
                    value={teamInfoDraft.nickname}
                    onChange={(e) => setTeamInfoDraft(d => ({ ...d, nickname: e.target.value }))}
                    placeholder="e.g. Yankees"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">Stadium</label>
                <input
                  type="text"
                  value={teamInfoDraft.stadium}
                  onChange={(e) => setTeamInfoDraft(d => ({ ...d, stadium: e.target.value }))}
                  placeholder="e.g. Yankee Stadium"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              {teamInfoError && <p className="text-red-600 text-sm">{teamInfoError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  disabled={savingTeamInfo}
                  onClick={async () => {
                    setSavingTeamInfo(true);
                    setTeamInfoError('');
                    const res = await fetch(`/api/teams/${teamId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(teamInfoDraft),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      setTeamInfoError(data.error ?? 'Failed to save');
                    } else {
                      const info = { location: data.location ?? '', nickname: data.nickname ?? '', stadium: data.stadium ?? '' };
                      setTeamInfo(info);
                      setTeamInfoDraft(info);
                      setEditingTeamInfo(false);
                    }
                    setSavingTeamInfo(false);
                  }}
                  className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingTeamInfo ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => { setTeamInfoDraft(teamInfo); setEditingTeamInfo(false); setTeamInfoError(''); }}
                  className="text-sm px-4 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {teamInfo.location && <span className="text-gray-800 dark:text-gray-200 font-semibold">{teamInfo.location} </span>}
                  {teamInfo.nickname || <span className="text-gray-400 italic">Unnamed Team</span>}
                </h1>
                {teamInfo.stadium && (
                  <p className="text-sm text-gray-500 mt-1">🏟️ {teamInfo.stadium}</p>
                )}
                {!teamInfo.location && !teamInfo.nickname && !teamInfo.stadium && isOwner && (
                  <p className="text-sm text-gray-400 italic mt-1">No team info set yet — click Edit to add your city, name, and stadium.</p>
                )}
              </div>
              {isOwner && (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={async () => {
                      setCoOwnerError('');
                      setCoOwnerSearch('');
                      if (allUsers.length === 0) {
                        const res = await fetch('/api/users');
                        if (res.ok) setAllUsers(await res.json());
                      }
                      setShowCoOwnerModal(true);
                    }}
                    className="text-xs text-purple-600 hover:text-purple-800 underline underline-offset-2"
                  >
                    + Co-owner
                  </button>
                  <button
                    onClick={() => { setTeamInfoDraft(teamInfo); setEditingTeamInfo(true); setTeamInfoError(''); }}
                    className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 whitespace-nowrap"
                  >
                    ✏️ Edit
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {!isOwner && !isAdmin && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-800">
              ℹ️ You are viewing this roster as a read-only member. Only the team owner can make changes.
            </p>
          </div>
        )}

        {isAdmin && !isOwner && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
            <p className="text-purple-800 font-medium">
              🔑 Admin Mode — you can edit this roster on behalf of the team owner.
            </p>
          </div>
        )}

        {/* Date picker + lock status on same row */}
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <label htmlFor="asOfDate" className="text-sm font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">
            View roster as of:
          </label>
          <input
            id="asOfDate"
            type="date"
            value={asOfDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => handleAsOfDateChange(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {asOfDate && (
            <button
              onClick={() => handleAsOfDateChange('')}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Reset to current
            </button>
          )}
          {!asOfDate && roster.locked && (
            <span className="ml-auto text-xs font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">🔒 Locked</span>
          )}
          {!asOfDate && !roster.locked && roster.timeUntilLock && (
            <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Locks in <strong className="text-gray-700 dark:text-gray-200">{formatTimeRemaining(roster.timeUntilLock)}</strong>
            </span>
          )}
        </div>

        {!asOfDate && !roster.locked && roster.nextGameDate && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Changes apply to: <strong className="text-gray-700 dark:text-gray-200">{new Date(roster.nextGameDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
          </p>
        )}
        {!asOfDate && roster.locked && (
          <p className="text-xs text-red-700 dark:text-red-400 mb-4">Roster locked — changes will apply to the next game day.</p>
        )}

        {asOfDate && roster && (
          <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg px-4 py-2 mb-4 text-sm text-blue-900 dark:text-blue-100">
            📅 Viewing roster as of <strong>{new Date(roster.effectiveDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
            {roster.effectiveDate !== asOfDate && (
              <span className="text-blue-700 dark:text-blue-300"> (most recent before {new Date(asOfDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})</span>
            )}
            {' '}— <em>read-only</em>
          </div>
        )}

        {(isOwner || isAdmin) && !roster.locked && seasonStatus !== 'pre-draft' && !embedded && (
          <div className="mb-4">
            {!rosterAtCapacity ? (
              <Link
                href={`/${league}/${season}/teams/${teamId}/free-agents`}
                className="inline-block bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                + Add Players
              </Link>
            ) : (
              <span className="inline-block bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 px-5 py-2 rounded-lg text-sm cursor-not-allowed" title={`Roster is at capacity (${ROSTER_LIMIT} active players)`}>
                + Add Players
              </span>
            )}
          </div>
        )}
        {(isOwner || isAdmin) && hasChanges && (
          <div className="flex gap-3 mb-4">
            {!roster.locked && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-green-600 text-white px-5 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-sm"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
            <button
              onClick={() => fetchRoster(asOfDate || undefined)}
              className="bg-gray-200 text-gray-700 px-5 py-2 rounded-lg hover:bg-gray-300 transition-colors text-sm"
            >
              Discard
            </button>
          </div>
        )}
        {seasonStatus === 'pre-draft' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-yellow-800 text-sm mb-4">
            ⏳ Season hasn&apos;t drafted yet — player adds will be available after the draft.
          </div>
        )}

        {/* Co-owner modal */}
        {!embedded && showCoOwnerModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Add Co-owner</h2>
                <button onClick={() => setShowCoOwnerModal(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>
              </div>

              {/* Current owners */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Current Owners</p>
                <div className="space-y-1">
                  {teamOwners.map((o: any) => (
                    <div key={o.userId} className="flex items-center justify-between text-sm px-3 py-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg gap-2">
                      <span className="font-medium text-gray-800 dark:text-gray-100">{o.name}</span>
                      {teamOwners.length > 1 && (
                        <button
                          disabled={removingCoOwner === o.userId}
                          onClick={async () => {
                            setRemovingCoOwner(o.userId);
                            setCoOwnerError('');
                            const res = await fetch(`/api/teams/${teamId}/co-owner`, {
                              method: 'DELETE',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId: o.userId }),
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              setCoOwnerError(data.error ?? 'Failed to remove co-owner');
                            } else {
                              setTeamOwners(data.owners ?? []);
                            }
                            setRemovingCoOwner(null);
                          }}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 whitespace-nowrap"
                        >
                          {removingCoOwner === o.userId ? 'Removing…' : 'Remove'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Add from site users</p>
              <input
                type="text"
                placeholder="Search by name…"
                value={coOwnerSearch}
                onChange={(e) => setCoOwnerSearch(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-purple-400"
              />

              {coOwnerError && (
                <p className="text-red-600 dark:text-red-400 text-sm mb-3">{coOwnerError}</p>
              )}

              <div className="space-y-1 max-h-56 overflow-y-auto">
                {allUsers
                  .filter((u) => {
                    if (teamOwners.some((o: any) => o.userId === u.userId)) return false;
                    const q = coOwnerSearch.toLowerCase();
                    return !q || u.name.toLowerCase().includes(q);
                  })
                  .map((u) => (
                    <button
                      key={u.userId}
                      disabled={addingCoOwner}
                      onClick={async () => {
                        setAddingCoOwner(true);
                        setCoOwnerError('');
                        const res = await fetch(`/api/teams/${teamId}/co-owner`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: u.userId, name: u.name }),
                        });
                        const data = await res.json();
                        if (!res.ok) {
                          setCoOwnerError(data.error ?? 'Failed to add co-owner');
                        } else {
                          setTeamOwners(data.owners ?? []);
                          setShowCoOwnerModal(false);
                        }
                        setAddingCoOwner(false);
                      }}
                      className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-left bg-transparent hover:bg-purple-50 dark:hover:bg-purple-900/40 transition-colors disabled:opacity-50"
                    >
                      <span className="font-medium text-gray-800 dark:text-gray-100">{u.name}</span>
                    </button>
                  ))}
                {allUsers.filter((u) => {
                  if (teamOwners.some((o: any) => o.userId === u.userId)) return false;
                  const q = coOwnerSearch.toLowerCase();
                  return !q || u.name.toLowerCase().includes(q);
                }).length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-300 px-3 py-2">No matching users found.</p>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* View toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => handleViewChange('stats')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            rosterView === 'stats'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Current Stats
        </button>
        <button
          onClick={() => handleViewChange('eligibility')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            rosterView === 'eligibility'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Position Eligibility
        </button>
        <button
          onClick={() => handleViewChange('splits')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            rosterView === 'splits'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Splits
        </button>
        {rosterView === 'splits' && (
          <select
            value={splitPeriod}
            onChange={e => setSplitPeriod(Number(e.target.value))}
            className="rounded border px-3 py-2 text-sm"
          >
            {SPLIT_PERIODS_ROSTER.map(n => (
              <option key={n} value={n}>Last {n} days</option>
            ))}
          </select>
        )}
        {rosterView === 'splits' && splitsLoading && (
          <span className="text-xs text-blue-500 animate-pulse">Loading splits…</span>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-lg min-h-60">
        {rosterView === 'eligibility' && posLogsLoading && (
          <div className="text-center py-4 text-sm text-gray-500">Loading position data…</div>
        )}

        {/* ── Mobile card list (hidden on md+) ── */}
        <div className="block md:hidden divide-y divide-gray-100">
          {(() => {
            const starterSet = getStarterSet(roster.roster);
            return roster.roster.map((item, index) => {
              const isDrafted = item.acqType === 'draft' || item.acqType === 'supp_draft';
              const isStarter = starterSet.has(index);
              const canDrag = !roster.locked && (isOwner || isAdmin);
              const canDrop = !roster.locked && !isDrafted && (isOwner || isAdmin);
              const b = item.player.stats?.batting;
              const sb = b?.stolenBases ?? null;
              const cs = b?.caughtStealing ?? null;
              const netSb = (sb !== null || cs !== null) ? (sb ?? 0) - (cs ?? 0) : null;

              const upBlocked = index === 0 ||
                ((item.acqType === 'fa' || item.acqType === 'trade') &&
                  (roster.roster[index - 1]?.acqType === 'draft' || roster.roster[index - 1]?.acqType === 'supp_draft'));
              const downBlocked = index >= roster.roster.length - 1 ||
                ((item.acqType === 'draft' || item.acqType === 'supp_draft') &&
                  (roster.roster[index + 1]?.acqType === 'fa' || roster.roster[index + 1]?.acqType === 'trade'));

              const mlbId = String(item.player.mlbID ?? '');
              const ps = splitsData?.[mlbId];

              return (
                <div
                  key={item.player._id}
                  className={`flex items-stretch gap-0 ${isStarter ? 'bg-emerald-50' : isDrafted ? 'bg-yellow-50' : 'bg-white'}`}
                >
                  {/* Up/down arrows */}
                  {canDrag ? (
                    <div className="flex flex-col items-center justify-center gap-0 px-2 py-3 shrink-0">
                      <button
                        onClick={() => handleMoveUp(index)}
                        disabled={upBlocked}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed p-1 leading-none"
                        aria-label="Move up"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2L11 8H1L6 2Z"/></svg>
                      </button>
                      <button
                        onClick={() => handleMoveDown(index)}
                        disabled={downBlocked}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed p-1 leading-none"
                        aria-label="Move down"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M6 10L1 4H11L6 10Z"/></svg>
                      </button>
                    </div>
                  ) : (
                    <div className="w-8 shrink-0" />
                  )}

                  {/* Main content */}
                  <div className="flex-1 min-w-0 py-2.5">
                    {/* Line 1: name · team · elig · status icon */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900">{item.player.name}</span>
                      {(item.player.team || item.player.eligible?.length) && (
                        <span className="text-xs text-gray-400">
                          {item.player.team}{item.player.eligible?.length ? ` · ${item.player.eligible.join(', ')}` : ''}
                        </span>
                      )}
                      {/* Status icon */}
                      {item.player.status?.includes('Injured') ? (
                        /* Red cross — IL */
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 shrink-0" title="Injured List">
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="white">
                            <rect x="3" y="0" width="2" height="8" rx="1"/>
                            <rect x="0" y="3" width="8" height="2" rx="1"/>
                          </svg>
                        </span>
                      ) : item.player.status?.includes('Minors') ? (
                        /* Amber down-arrow — sent down */
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 shrink-0" title="In Minors">
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="white">
                            <path d="M4 7L0.5 2.5h7L4 7Z"/>
                            <rect x="3" y="0" width="2" height="3.5" rx="1"/>
                          </svg>
                        </span>
                      ) : item.player.status ? (
                        /* Green A — active */
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-500 text-white text-[9px] font-bold leading-none shrink-0" title="Active">A</span>
                      ) : (
                        /* Gray NR — non-roster */
                        <span className="text-[10px] text-gray-400 font-medium shrink-0">NR</span>
                      )}
                    </div>
                    {/* Line 2: supplemental stats */}
                    {rosterView === 'stats' && (() => {
                      const fmt = (n: number | null | undefined) => {
                        if (n == null) return '—';
                        const s = n.toFixed(3);
                        return s.startsWith('0.') ? s.slice(1) : s;
                      };
                      const slashLine = `${fmt(b?.avg)}/${fmt(b?.slg)}/${fmt(b?.ops)}`;
                      return (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs font-semibold text-blue-700">ABL {item.player.abl?.toFixed(2) ?? '—'}</span>
                          {b?.atBats != null && <span className="text-[11px] text-gray-400">AB {b.atBats}</span>}
                          <span className="text-[11px] text-gray-500 font-medium">{slashLine}</span>
                        </div>
                      );
                    })()}
                    {rosterView === 'splits' && (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs font-semibold text-blue-700">ABL {item.player.abl?.toFixed(2) ?? '—'}</span>
                        {splitsLoading ? (
                          <span className="text-[11px] text-gray-300">…</span>
                        ) : ps?.lastN?.[splitPeriod] ? (
                          <span className="text-[11px] text-gray-400">L{splitPeriod}: {ps.lastN[splitPeriod].abl?.toFixed(2) ?? '—'} ({ps.lastN[splitPeriod].g}/{ps.lastN[splitPeriod].ab})</span>
                        ) : null}
                      </div>
                    )}
                    {rosterView === 'eligibility' && (() => {
                      const log = posLogs.get(item.player.mlbID);
                      if (!log) return <span className="text-[11px] text-gray-300 mt-1 block">…</span>;
                      return (
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="text-xs font-semibold text-blue-700">ABL {item.player.abl?.toFixed(2) ?? '—'}</span>
                          {STANDARD_POSITIONS.map(pos => {
                            const entry = log.positionsLog.find(e => e.pos === pos);
                            const ct = entry?.ct ?? 0;
                            if (ct === 0) return null;
                            const elig = ct >= ELIGIBILITY_THRESHOLD;
                            return (
                              <span key={pos} className={`text-[11px] font-medium ${elig ? 'text-green-700' : 'text-gray-400'}`}>
                                {pos} {ct}{elig ? '✓' : ''}
                              </span>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Right column: pos selector + drop, full-height centered */}
                  <div className="flex flex-col items-center justify-center gap-1 px-3 py-2 border-l border-gray-100 shrink-0 min-w-[4rem]">
                    {!roster.locked && (isOwner || isAdmin) ? (
                      <select
                        value={item.lineupPosition || ''}
                        onChange={e => handlePositionChange(index, e.target.value)}
                        className="text-xs border rounded px-1 py-1 bg-white w-full text-center"
                      >
                        <option value="">--</option>
                        {item.player.status?.includes('Injured') && <option value="INJ">INJ</option>}
                        {item.player.status?.includes('Minors') && <option value="NA">NA</option>}
                        {!item.player.status && <option value="NR">NR</option>}
                        {item.player.eligible?.map(pos => <option key={pos} value={pos}>{pos}</option>)}
                      </select>
                    ) : (
                      <span className="text-sm font-medium text-gray-700">{item.lineupPosition || '--'}</span>
                    )}
                    {canDrop && (
                      <button
                        onClick={() => handleDropPlayer(item.player._id, item.player.name, item.acqType || '')}
                        className="text-red-400 hover:text-red-600 text-[10px] font-medium"
                      >
                        Drop
                      </button>
                    )}
                  </div>
                </div>
              );
            });
          })()}
          {roster.roster.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              {seasonStatus === 'pre-draft'
                ? 'No players yet — rosters are filled during the draft.'
                : 'No players on roster. Add players from Free Agents.'}
            </div>
          )}
        </div>

        {/* ── Desktop table (hidden below md) ── */}
        <table className="hidden md:table min-w-full divide-y divide-gray-200">
          <thead
            ref={theadRef}
            className="bg-gray-50 sticky z-10 shadow-sm"
            style={{ top: 'var(--app-header-height, 0px)' }}
          >
            <tr>
              <th className="px-2 py-3 w-8"></th>
              <th className="hidden sm:table-cell px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">#</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Player</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Pos</th>
              {rosterView === 'stats' ? (
                <>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">ABL</th>
                  <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">G</th>
                  <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">AB</th>
                  <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">H</th>
                  <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">HR</th>
                  <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">BB</th>
                  <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">SB(net)</th>
                  <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">HBP</th>
                  <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">E</th>
                </>
              ) : rosterView === 'splits' ? (
                <>
                  <th className="px-3 py-3 text-center text-xs font-medium text-green-700 uppercase">ABL</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase hidden sm:table-cell">
                    L{splitPeriod}
                    <div className="text-[10px] font-normal normal-case text-gray-400 leading-tight">G/AB</div>
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-blue-600 uppercase hidden md:table-cell">
                    ABL On
                    <div className="text-[10px] font-normal normal-case text-gray-400 leading-tight">G/AB</div>
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-orange-600 uppercase hidden md:table-cell">
                    ABL Off
                    <div className="text-[10px] font-normal normal-case text-gray-400 leading-tight">G/AB</div>
                  </th>
                </>
              ) : (
                <>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">ABL</th>
                  {STANDARD_POSITIONS.map(pos => (
                    <th key={pos} className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">{pos}</th>
                  ))}
                </>
              )}
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {(() => {
              const starterSet = getStarterSet(roster.roster);
              return roster.roster.map((item, index) => {
              const isDrafted =
                item.acqType === 'draft' ||
                item.acqType === 'supp_draft';
              const isStarter = starterSet.has(index);
              const canDrag = !roster.locked && (isOwner || isAdmin);
              const canDrop = !roster.locked && !isDrafted && (isOwner || isAdmin);
              const b = item.player.stats?.batting;
              const sb = b?.stolenBases ?? null;
              const cs = b?.caughtStealing ?? null;
              const netSb = (sb !== null || cs !== null) ? (sb ?? 0) - (cs ?? 0) : null;

              const upBlocked = index === 0 ||
                ((item.acqType === 'fa' || item.acqType === 'trade') &&
                  (roster.roster[index - 1]?.acqType === 'draft' || roster.roster[index - 1]?.acqType === 'supp_draft'));
              const downBlocked = index >= roster.roster.length - 1 ||
                ((item.acqType === 'draft' || item.acqType === 'supp_draft') &&
                  (roster.roster[index + 1]?.acqType === 'fa' || roster.roster[index + 1]?.acqType === 'trade'));

              return (
                <tr
                  key={item.player._id}
                  data-index={index}
                  draggable={canDrag}
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={e => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`${draggedIndex === index ? 'opacity-50' : ''} ${
                    canDrag ? 'hover:bg-gray-50' : ''
                  } ${isStarter ? 'bg-emerald-50' : isDrafted ? 'bg-yellow-50' : ''}`}
                >
                  <td className="px-1 py-2 sm:px-2 sm:py-4 w-8 text-center">
                    {canDrag && (
                      <>
                        {/* Desktop: drag handle */}
                        <div
                          className="hidden sm:flex cursor-grab text-gray-400 hover:text-gray-600 active:text-gray-800 items-center justify-center select-none"
                          style={{ touchAction: 'none' }}
                          data-drag-handle="true"
                          aria-label="Drag to reorder"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                            <circle cx="5.5" cy="4" r="1.5" />
                            <circle cx="10.5" cy="4" r="1.5" />
                            <circle cx="5.5" cy="8" r="1.5" />
                            <circle cx="10.5" cy="8" r="1.5" />
                            <circle cx="5.5" cy="12" r="1.5" />
                            <circle cx="10.5" cy="12" r="1.5" />
                          </svg>
                        </div>
                        {/* Mobile: up/down arrows */}
                        <div className="flex sm:hidden flex-col items-center gap-0.5">
                          <button
                            onClick={() => handleMoveUp(index)}
                            disabled={upBlocked}
                            className="text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed p-0.5 leading-none"
                            aria-label="Move up"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M6 2L11 8H1L6 2Z"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => handleMoveDown(index)}
                            disabled={downBlocked}
                            className="text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed p-0.5 leading-none"
                            aria-label="Move down"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M6 10L1 4H11L6 10Z"/>
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </td>
                  <td className="hidden sm:table-cell px-3 py-2 sm:py-4 text-sm font-medium text-gray-900">{item.rosterOrder}</td>
                  <td className="px-2 sm:px-3 py-2 sm:py-4 text-sm">
                    <div className="font-medium text-gray-900 flex items-center gap-1">
                      {item.player.name}
                      {isStarter && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1 rounded leading-tight">STR</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      {item.player.team} {item.player.eligible ? `- ${item.player.eligible.join(', ')}` : ''}
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 sm:py-4 text-center">
                    <div className="flex gap-1 justify-center items-center">
                      {item.player.status ? (
                        <>
                          {item.player.status.includes('Injured') && (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-red-200 text-red-800 font-medium">INJ</span>
                          )}
                          {item.player.status.includes('Minors') && (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-orange-200 text-orange-800 font-medium">MIN</span>
                          )}
                          {!item.player.status.includes('Injured') && !item.player.status.includes('Minors') && (
                            <span className="text-xs text-gray-600">{item.player.status}</span>
                          )}
                        </>
                      ) : (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-gray-200 text-gray-600 font-medium">NR</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 sm:py-4 text-center">
                    {!roster.locked && (isOwner || isAdmin) ? (
                      <select
                        value={item.lineupPosition || ''}
                        onChange={e => handlePositionChange(index, e.target.value)}
                        className="text-xs sm:text-sm border rounded px-1 sm:px-2 py-1"
                      >
                        <option value="">--</option>
                        {item.player.status?.includes('Injured') && (
                          <option value="INJ">INJ (Injured)</option>
                        )}
                        {item.player.status?.includes('Minors') && (
                          <option value="NA">NA (Minors)</option>
                        )}
                        {!item.player.status && (
                          <option value="NR">NR (Non-Roster)</option>
                        )}
                        {item.player.eligible?.map(pos => (
                          <option key={pos} value={pos}>{pos}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm">{item.lineupPosition || '--'}</span>
                    )}
                  </td>
                  {rosterView === 'stats' ? (
                    <>
                      <td className="px-3 py-2 sm:py-4 text-center text-sm font-medium text-gray-900">
                        {item.player.abl?.toFixed(2) ?? '—'}
                      </td>
                      <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center text-sm text-gray-900">{b?.gamesPlayed ?? '—'}</td>
                      <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center text-sm text-gray-900">{b?.atBats ?? '—'}</td>
                      <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center text-sm text-gray-900">{b?.hits ?? '—'}</td>
                      <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center text-sm text-gray-900">{b?.homeRuns ?? '—'}</td>
                      <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center text-sm text-gray-900">{(b?.baseOnBalls ?? 0) > 0 ? b?.baseOnBalls : '—'}</td>
                      <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center text-sm text-gray-900">{netSb !== null ? netSb : '—'}</td>
                      <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center text-sm text-gray-900">{(b?.hitByPitch ?? 0) > 0 ? b?.hitByPitch : '—'}</td>
                      <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center text-sm text-gray-900">
                        {(item.player.stats?.fielding?.errors ?? 0) > 0 ? (
                          <span className="text-red-600 font-medium">{item.player.stats.fielding.errors}</span>
                        ) : '—'}
                      </td>
                    </>
                  ) : rosterView === 'splits' ? (() => {
                      const mlbId = String(item.player.mlbID ?? '');
                      const ps = splitsData?.[mlbId];
                      const renderBucketContent = (bucket: { g: number; ab: number; abl: number | null } | undefined) => {
                        if (splitsLoading) return <span className="text-xs text-gray-300">…</span>;
                        if (!bucket) return <span className="text-xs text-gray-300">—</span>;
                        const ablColor = bucket.abl === null ? 'text-gray-400' : bucket.abl >= 0 ? 'text-green-700' : 'text-red-500';
                        return (
                          <>
                            <div className={`text-sm font-medium ${ablColor}`}>{bucket.abl !== null ? bucket.abl.toFixed(2) : '—'}</div>
                            <div className="text-[10px] text-gray-400 leading-tight">{bucket.g}/{bucket.ab}</div>
                          </>
                        );
                      };
                      return (
                        <>
                          <td className="px-3 py-2 sm:py-4 text-center text-sm font-medium text-gray-900">
                            {item.player.abl?.toFixed(2) ?? '—'}
                          </td>
                          <td className="hidden sm:table-cell px-3 py-2 sm:py-4 text-center">
                            {renderBucketContent(ps?.lastN?.[splitPeriod])}
                          </td>
                          <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center">
                            {renderBucketContent(ps?.ablOn)}
                          </td>
                          <td className="hidden md:table-cell px-3 py-2 sm:py-4 text-center">
                            {renderBucketContent(ps?.ablOff)}
                          </td>
                        </>
                      );
                    })()
                  : (
                    <>
                      <td className="px-3 py-2 sm:py-4 text-center text-sm font-medium text-gray-900">
                        {item.player.abl?.toFixed(2) ?? '—'}
                      </td>
                      {STANDARD_POSITIONS.map(pos => {
                        const log = posLogs.get(item.player.mlbID);
                        const entry = log?.positionsLog.find(e => e.pos === pos);
                        const ct = entry?.ct ?? 0;
                        const eligible = ct >= ELIGIBILITY_THRESHOLD;
                        const hasGames = ct > 0;
                        return (
                          <td key={pos} className="px-3 py-2 sm:py-4 text-center text-sm tabular-nums">
                            {!log ? (
                              <span className="text-gray-300">…</span>
                            ) : hasGames ? (
                              <span className={eligible ? 'text-green-700 font-semibold' : 'text-gray-500'}>
                                {ct}{eligible ? ' ✓' : ''}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </>
                  )}
                  <td className="px-2 sm:px-3 py-2 sm:py-4 text-center">
                    {canDrop ? (
                      <button
                        onClick={() =>
                          handleDropPlayer(item.player._id, item.player.name, item.acqType || '')
                        }
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        Drop
                      </button>
                    ) : (
                      <span className="text-gray-400 text-sm">—</span>
                    )}
                  </td>
                </tr>
              );
              });
            })()}
          </tbody>
        </table>

        {roster.roster.length === 0 && (
          <div className="hidden md:block text-center py-12 text-gray-500">
            {seasonStatus === 'pre-draft'
              ? 'No players yet — rosters are filled during the draft.'
              : 'No players on roster. Add players from Free Agents.'}
          </div>
        )}
      </div>

      <div className="relative inline-block mt-4 mb-2">
        <button
          onClick={() => setShowRulesPopover(v => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors"
          aria-label="Roster rules"
        >
          <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center font-bold text-[10px] leading-none">i</span>
          Roster Rules
        </button>
        {showRulesPopover && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowRulesPopover(false)} aria-hidden />
            <div className="absolute left-0 top-6 z-20 w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-4">
              <h4 className="font-semibold text-sm text-gray-800 mb-2">Roster Rules</h4>
              <ul className="text-sm text-gray-600 space-y-1.5">
                <li>• Drafted players cannot be dropped</li>
                <li>• Drafted players must appear first in roster order</li>
                <li>• Pickups can only be placed after all drafted players</li>
                <li>• Drag and drop rows to reorder (within rules) — use the grip handle on mobile</li>
              </ul>
            </div>
          </>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-2">Drafted Players</h3>
          <p className="text-3xl font-bold text-yellow-900 dark:text-yellow-100">{draftedPlayers.length}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">Pickups</h3>
          <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">{pickupPlayers.length}</p>
        </div>
      </div>
    </div>
  );
}
