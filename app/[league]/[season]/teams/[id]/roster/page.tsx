'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useLeagueSeason } from '@/app/lib/league-season-context';

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
  roster: RosterItem[];
  updatedAt: string;
  locked: boolean;
  timeUntilLock: number | null;
  nextGame?: {
    _id: string;
    gameDate: string;
    homeTeam: any;
    awayTeam: any;
  };
}

export default function TeamRosterPage() {
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

  useEffect(() => {
    fetchUserAndRoster();
  }, [teamId]);

  const fetchUserAndRoster = async () => {
    try {
      setLoading(true);

      const userRes = await fetch('/api/auth/me');
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

  const fetchRoster = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/teams/${teamId}/roster`);
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

  const handleDragStart = (index: number) => {
    if (roster?.locked || !isOwner) return;
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index || !roster || roster.locked || !isOwner) return;

    const items = [...roster.roster];
    const draggedItem = items[draggedIndex];
    const targetItem = items[index];

    const isDraggedPickup =
      draggedItem.player.ablstatus?.acqType === 'fa' ||
      draggedItem.player.ablstatus?.acqType === 'trade';
    const isTargetDrafted =
      targetItem.player.ablstatus?.acqType === 'draft' ||
      targetItem.player.ablstatus?.acqType === 'supp_draft';

    if (isDraggedPickup && isTargetDrafted && index < draggedIndex) return;

    items.splice(draggedIndex, 1);
    items.splice(index, 0, draggedItem);
    items.forEach((item, idx) => { item.rosterOrder = idx + 1; });

    setRoster({ ...roster, roster: items });
    setDraggedIndex(index);
    setHasChanges(true);
  };

  const handleDragEnd = () => { setDraggedIndex(null); };

  // Refs so native (non-passive) touch handlers always see fresh state without stale closures
  const rosterRef = useRef<RosterData | null>(null);
  const draggedIndexRef = useRef<number | null>(null);
  const isOwnerRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { rosterRef.current = roster; }, [roster]);
  useEffect(() => { isOwnerRef.current = isOwner; }, [isOwner]);

  // React registers onTouchMove as passive (cannot call preventDefault), so iOS Safari
  // intercepts the gesture for scrolling before our handler can reorder rows.
  // Solution: attach non-passive native listeners to document so preventDefault works.
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      const handle = (e.target as Element).closest('[data-drag-handle]') as HTMLElement | null;
      if (!handle) return;
      if (!isOwnerRef.current || rosterRef.current?.locked) return;
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
      if (!currentRoster || currentRoster.locked || !isOwnerRef.current) return;
      const touch = e.touches[0];
      const elem = document.elementFromPoint(touch.clientX, touch.clientY);
      const row = elem?.closest('tr[data-index]') as HTMLElement | null;
      if (!row) return;
      const targetIndex = parseInt(row.dataset.index ?? '-1', 10);
      if (isNaN(targetIndex) || targetIndex < 0 || targetIndex === currentDraggedIndex) return;
      const items = [...currentRoster.roster];
      const draggedItem = items[currentDraggedIndex];
      const targetItem = items[targetIndex];
      const isDraggedPickup =
        draggedItem.player.ablstatus?.acqType === 'fa' ||
        draggedItem.player.ablstatus?.acqType === 'trade';
      const isTargetDrafted =
        targetItem.player.ablstatus?.acqType === 'draft' ||
        targetItem.player.ablstatus?.acqType === 'supp_draft';
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
    if (!roster || roster.locked || !isOwner) return;
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
    if (!isOwner) { alert('Only the team owner can modify the roster'); return; }
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading roster...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  if (!roster) return null;

  const draftedPlayers = roster.roster.filter(
    r => r.player.ablstatus?.acqType === 'draft' || r.player.ablstatus?.acqType === 'supp_draft'
  );
  const pickupPlayers = roster.roster.filter(
    r => r.player.ablstatus?.acqType === 'fa' || r.player.ablstatus?.acqType === 'trade'
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Link href={`/${league}/${season}`} className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to Home
        </Link>

        {/* Team info header */}
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

        {!isOwner && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-800">
              ℹ️ You are viewing this roster as a read-only member. Only the team owner can make changes.
            </p>
          </div>
        )}

        <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg mb-4 text-sm ${roster.locked ? 'bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700' : 'bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700'}`}>
          <span className={`font-semibold ${roster.locked ? 'text-red-900 dark:text-red-100' : 'text-green-900 dark:text-green-100'}`}>{roster.locked ? '🔒 Roster Locked' : '🟢 Roster Open'}</span>
          {!roster.locked && roster.timeUntilLock && (
            <span className="text-green-900 dark:text-green-100">
              Time remaining to next lock: <strong className="text-green-900 dark:text-green-100">{formatTimeRemaining(roster.timeUntilLock)}</strong>
            </span>
          )}
        </div>

        {isOwner && hasChanges && (
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
              onClick={fetchRoster}
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
        {showCoOwnerModal && (
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

        <div className="relative inline-block mb-6">
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
      </div>

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-3 w-8"></th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">#</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Player</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Pos</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">ABL</th>
              <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">G</th>
              <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">AB</th>
              <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">H</th>
              <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">HR</th>
              <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">BB</th>
              <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">SB(net)</th>
              <th className="hidden md:table-cell px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">HBP</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {roster.roster.map((item, index) => {
              const isDrafted =
                item.acqType === 'draft' ||
                item.acqType === 'supp_draft';
              const canDrag = !roster.locked && isOwner;
              const canDrop = !roster.locked && !isDrafted && isOwner;
              const b = item.player.stats?.batting;
              const sb = b?.stolenBases ?? null;
              const cs = b?.caughtStealing ?? null;
              const netSb = (sb !== null || cs !== null) ? (sb ?? 0) - (cs ?? 0) : null;

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
                  } ${isDrafted ? 'bg-yellow-50' : ''}`}
                >
                  <td className="px-2 py-4 w-8 text-center">
                    {canDrag && (
                      <div
                        className="cursor-grab text-gray-400 hover:text-gray-600 active:text-gray-800 flex items-center justify-center select-none"
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
                    )}
                  </td>
                  <td className="px-3 py-4 text-sm font-medium text-gray-900">{item.rosterOrder}</td>
                  <td className="px-3 py-4 text-sm">
                    <div className="font-medium text-gray-900">{item.player.name}</div>
                    <div className="text-xs text-gray-500">
                      {item.player.team} {item.player.eligible ? `- ${item.player.eligible.join(', ')}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-4 text-center">
                    <div className="flex gap-1 justify-center items-center">
                      {item.player.status ? (
                        <>
                          {item.player.status.includes('Injured') && (
                            <span className="px-2 py-1 text-xs rounded bg-red-200 text-red-800 font-medium">INJ</span>
                          )}
                          {item.player.status.includes('Minors') && (
                            <span className="px-2 py-1 text-xs rounded bg-orange-200 text-orange-800 font-medium">MIN</span>
                          )}
                          {!item.player.status.includes('Injured') && !item.player.status.includes('Minors') && (
                            <span className="text-xs text-gray-600">{item.player.status}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-4 text-center">
                    {!roster.locked && isOwner ? (
                      <select
                        value={item.lineupPosition || ''}
                        onChange={e => handlePositionChange(index, e.target.value)}
                        className="text-sm border rounded px-2 py-1"
                      >
                        <option value="">--</option>
                        {item.player.eligible?.map(pos => (
                          <option key={pos} value={pos}>{pos}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm">{item.lineupPosition || '--'}</span>
                    )}
                  </td>
                  <td className="px-3 py-4 text-center text-sm font-medium text-gray-900">
                    {item.player.abl?.toFixed(2) ?? '—'}
                  </td>
                  <td className="hidden md:table-cell px-3 py-4 text-center text-sm text-gray-900">{b?.gamesPlayed ?? '—'}</td>
                  <td className="hidden md:table-cell px-3 py-4 text-center text-sm text-gray-900">{b?.atBats ?? '—'}</td>
                  <td className="hidden md:table-cell px-3 py-4 text-center text-sm text-gray-900">{b?.hits ?? '—'}</td>
                  <td className="hidden md:table-cell px-3 py-4 text-center text-sm text-gray-900">{b?.homeRuns ?? '—'}</td>
                  <td className="hidden md:table-cell px-3 py-4 text-center text-sm text-gray-900">{(b?.baseOnBalls ?? 0) > 0 ? b?.baseOnBalls : '—'}</td>
                  <td className="hidden md:table-cell px-3 py-4 text-center text-sm text-gray-900">{netSb !== null ? netSb : '—'}</td>
                  <td className="hidden md:table-cell px-3 py-4 text-center text-sm text-gray-900">{(b?.hitByPitch ?? 0) > 0 ? b?.hitByPitch : '—'}</td>
                  <td className="px-3 py-4 text-center">
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
            })}
          </tbody>
        </table>

        {roster.roster.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {seasonStatus === 'pre-draft'
              ? 'No players yet — rosters are filled during the draft.'
              : 'No players on roster. Add players from Free Agents.'}
          </div>
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
