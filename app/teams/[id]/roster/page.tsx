'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

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
  const router = useRouter();
  const teamId = params.id as string;

  const [roster, setRoster] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetchUserAndRoster();
  }, [teamId]);

  const fetchUserAndRoster = async () => {
    try {
      setLoading(true);
      
      // Fetch current user and admin status in parallel
      const [userRes, adminRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/admin/me'),
      ]);
      if (userRes.ok) {
        const userData = await userRes.json();
        setCurrentUser(userData?.user);

        // Fetch team to check ownership
        const teamRes = await fetch(`/api/teams/${teamId}`);
        if (teamRes.ok) {
          const team = await teamRes.json();
          const userOwnsTeam = team.owners?.some((o: any) => o.userId === userData?.user?.sub);
          setIsOwner(userOwnsTeam || false);
        }
      }
      if (adminRes.ok) {
        const adminData = await adminRes.json();
        setIsAdmin(adminData?.isAdmin || false);
      }

      // Fetch roster
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
    if (roster?.locked || (!isOwner && !isAdmin)) return;
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index || !roster || roster.locked || (!isOwner && !isAdmin)) return;

    const items = [...roster.roster];
    const draggedItem = items[draggedIndex];
    const targetItem = items[index];

    // RULE: Cannot move pickups above drafted players
    const isDraggedPickup = draggedItem.acqType === 'fa' || 
                           draggedItem.acqType === 'trade';
    const isTargetDrafted = targetItem.acqType === 'draft' || 
                           targetItem.acqType === 'supp_draft';

    if (isDraggedPickup && isTargetDrafted && index < draggedIndex) {
      // Trying to move a pickup above a drafted player - not allowed
      return;
    }

    // Reorder
    items.splice(draggedIndex, 1);
    items.splice(index, 0, draggedItem);

    // Update rosterOrder
    items.forEach((item, idx) => {
      item.rosterOrder = idx + 1;
    });

    setRoster({ ...roster, roster: items });
    setDraggedIndex(index);
    setHasChanges(true);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Refs so native (non-passive) touch handlers always see fresh state without stale closures
  const rosterRef = useRef<RosterData | null>(null);
  const draggedIndexRef = useRef<number | null>(null);
  const isOwnerRef = useRef(false);
  const canEditRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { rosterRef.current = roster; }, [roster]);
  useEffect(() => { isOwnerRef.current = isOwner; }, [isOwner]);
  useEffect(() => { canEditRef.current = isOwner || isAdmin; }, [isOwner, isAdmin]);

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
        body: JSON.stringify({ roster: roster.roster })
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
    if (!isOwner && !isAdmin) {
      alert('Only the team owner or an admin can modify the roster');
      return;
    }

    if (roster?.locked) {
      alert('Roster is locked for next game');
      return;
    }

    if (acqType === 'draft' || acqType === 'supp_draft') {
      alert('Cannot drop drafted players');
      return;
    }

    if (!confirm(`Drop ${playerName}?`)) return;

    try {
      const res = await fetch(`/api/teams/${teamId}/roster/${playerId}`, {
        method: 'DELETE'
      });

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

  const draftedPlayers = roster.roster.filter(r => 
    r.acqType === 'draft' || r.acqType === 'supp_draft'
  );
  const pickupPlayers = roster.roster.filter(r => 
    r.acqType === 'fa' || r.acqType === 'trade'
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Link href="/" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to Home
        </Link>

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

        {/* Lock Status */}
        <div className={`p-4 rounded-lg mb-6 ${roster.locked ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className="font-semibold text-lg">
                {roster.locked ? '🔒 Roster Locked' : '✏️ Roster Editable'}
              </h2>
              {roster.nextGame && (
                <p className="text-sm text-gray-700">
                  Next Game: {new Date(roster.nextGame.gameDate).toLocaleString()}
                </p>
              )}
              {roster.effectiveDate && (
                <p className="text-sm text-gray-600">
                  Lock Time: {new Date(roster.effectiveDate).toLocaleString()}
                </p>
              )}
            </div>
            {!roster.locked && roster.timeUntilLock && (
              <div className="text-right">
                <p className="text-sm text-gray-600">Time Remaining:</p>
                <p className="text-2xl font-bold text-green-700">
                  {formatTimeRemaining(roster.timeUntilLock)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 mb-6">
          {(isOwner || isAdmin) && (
            <>
              <Link
                href={`/teams/${teamId}/free-agents`}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                Add Players
              </Link>
              {hasChanges && !roster.locked && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              )}
              {hasChanges && (
                <button
                  onClick={fetchRoster}
                  className="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Discard Changes
                </button>
              )}
            </>
          )}
        </div>

        {/* Rules Notice */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2">Roster Rules:</h3>
          <ul className="text-sm text-gray-700 space-y-1">
            <li>• Drafted players cannot be dropped</li>
            <li>• Drafted players must appear first in roster order</li>
            <li>• Pickups can only be placed after all drafted players</li>
            <li>• Drag and drop to reorder (within rules) — use the grip handle on mobile</li>
          </ul>
        </div>
      </div>

      {/* Roster Table */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-3 w-8"></th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">#</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Player</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">MLB Team</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Pos</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Eligible</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">ABL Runs</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {roster.roster.map((item, index) => {
              const isDrafted = item.acqType === 'draft' || 
                               item.acqType === 'supp_draft';
              const canDrag = !roster.locked && (isOwner || isAdmin);
              const canDrop = !roster.locked && !isDrafted && (isOwner || isAdmin);

              return (
                <tr
                  key={item.player._id}
                  data-index={index}
                  draggable={canDrag}
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`${draggedIndex === index ? 'opacity-50' : ''} ${
                    canDrag ? 'hover:bg-gray-50' : ''
                  } ${
                    isDrafted ? 'bg-yellow-50' : ''
                  }`}
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
                  <td className="px-3 py-4 text-sm font-medium text-gray-900">
                    {item.rosterOrder}
                  </td>
                  <td className="px-3 py-4 text-sm">
                    <div className="font-medium text-gray-900">{item.player.name}</div>
                    <div className="text-xs text-gray-500">#{item.player.mlbID}</div>
                  </td>
                  <td className="px-3 py-4 text-center text-sm text-gray-900">
                    {item.player.team}
                  </td>
                  <td className="px-3 py-4 text-center">
                    {!roster.locked && (isOwner || isAdmin) ? (
                      <select
                        value={item.lineupPosition || ''}
                        onChange={(e) => handlePositionChange(index, e.target.value)}
                        className="text-sm border rounded px-2 py-1"
                      >
                        <option value="">--</option>
                        {item.player.status?.includes('Injured') && (
                          <option value="INJ">INJ (Injured)</option>
                        )}
                        {item.player.status?.includes('Minors') && (
                          <option value="NA">NA (Minors)</option>
                        )}
                        {item.player.eligible?.map(pos => (
                          <option key={pos} value={pos}>{pos}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm">{item.lineupPosition || '--'}</span>
                    )}
                  </td>
                  <td className="px-3 py-4 text-center text-xs text-gray-600">
                    {item.player.eligible?.join(', ') || '--'}
                  </td>
                  <td className="px-3 py-4 text-center">
                    <span className={`px-2 py-1 text-xs rounded ${
                      isDrafted 
                        ? 'bg-yellow-200 text-yellow-800' 
                        : 'bg-blue-200 text-blue-800'
                    }`}>
                      {isDrafted ? 'Draft' : 'Pickup'}
                    </span>
                  </td>
                  <td className="px-3 py-4 text-center">
                    <div className="flex gap-1 justify-center items-center">
                      {item.player.status ? (
                        <>
                          {item.player.status.includes('Injured') && (
                            <span className="px-2 py-1 text-xs rounded bg-red-200 text-red-800 font-medium">
                              INJ
                            </span>
                          )}
                          {item.player.status.includes('Minors') && (
                            <span className="px-2 py-1 text-xs rounded bg-orange-200 text-orange-800 font-medium">
                              MINORS
                            </span>
                          )}
                          {!item.player.status.includes('Injured') && !item.player.status.includes('Minors') && (
                            <span className="text-xs text-gray-600">{item.player.status}</span>
                          )}
                        </>
                      ) : (
                        <span className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-800">
                          N/A
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-4 text-center text-sm text-gray-900">
                    {item.player.abl?.toFixed(2) || '0.00'}
                  </td>
                  <td className="px-3 py-4 text-center">
                    {canDrop ? (
                      <button
                        onClick={() => handleDropPlayer(
                          item.player._id,
                          item.player.name,
                          item.acqType || ''
                        )}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        Drop
                      </button>
                    ) : (
                      <span className="text-gray-400 text-sm">--</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {roster.roster.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No players on roster. Add players from Free Agents.
          </div>
        )}
      </div>

      {/* Roster Summary */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-900 mb-2">Drafted Players</h3>
          <p className="text-3xl font-bold text-yellow-700">{draftedPlayers.length}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">Pickups</h3>
          <p className="text-3xl font-bold text-blue-700">{pickupPlayers.length}</p>
        </div>
      </div>
    </div>
  );
}
