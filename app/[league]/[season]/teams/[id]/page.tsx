'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useLeagueSeason } from '@/app/lib/league-season-context';

const TeamRosterPage = dynamic(() => import('./roster/page'), { ssr: false });
const TeamAnalyticsPage = dynamic(() => import('./analytics/page'), { ssr: false });

type Tab = 'details' | 'roster' | 'analytics';

interface Owner {
  userId?: string;
  name?: string;
  email?: string;
  verified?: boolean;
}

interface Team {
  _id: string;
  nickname: string;
  location?: string;
  stadium?: string;
  userId?: string;
  owners?: Owner[];
}

export default function TeamDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const teamId = params.id as string;
  const { league, season } = useLeagueSeason();

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('details');

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'details' || tabParam === 'roster' || tabParam === 'analytics') {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Auth
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Team info editing (header)
  const [teamInfo, setTeamInfo] = useState({ location: '', nickname: '', stadium: '' });
  const [teamInfoDraft, setTeamInfoDraft] = useState({ location: '', nickname: '', stadium: '' });
  const [editingTeamInfo, setEditingTeamInfo] = useState(false);
  const [savingTeamInfo, setSavingTeamInfo] = useState(false);
  const [teamInfoError, setTeamInfoError] = useState('');

  // Co-owner management
  const [teamOwners, setTeamOwners] = useState<Owner[]>([]);
  const [showCoOwnerModal, setShowCoOwnerModal] = useState(false);
  const [allUsers, setAllUsers] = useState<{ userId: string; name: string }[]>([]);
  const [coOwnerSearch, setCoOwnerSearch] = useState('');
  const [addingCoOwner, setAddingCoOwner] = useState(false);
  const [removingCoOwner, setRemovingCoOwner] = useState<string | null>(null);
  const [coOwnerError, setCoOwnerError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const [teamRes, userRes, adminRes] = await Promise.all([
          fetch(`/api/teams/${teamId}`),
          fetch('/api/auth/me').catch(() => null),
          fetch('/api/admin/me').catch(() => null),
        ]);

        if (!teamRes.ok) throw new Error('Failed to fetch team');
        const teamData = await teamRes.json();
        setTeam(teamData);

        const info = {
          location: teamData.location ?? '',
          nickname: teamData.nickname ?? '',
          stadium: teamData.stadium ?? '',
        };
        setTeamInfo(info);
        setTeamInfoDraft(info);
        setTeamOwners(teamData.owners ?? []);

        const userData = userRes?.ok ? await userRes.json() : null;
        const adminData = adminRes?.ok ? await adminRes.json() : null;

        const userSub = userData?.user?.sub;
        if (userSub && teamData.owners) {
          setIsOwner(teamData.owners.some((o: Owner) => o.userId === userSub));
        }
        setIsAdmin(adminData?.isAdmin ?? false);
      } catch (err) {
        setError('Failed to load team details');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    if (teamId) fetchData();
  }, [teamId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading team details...</div>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-600">{error || 'Team not found'}</div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'details', label: 'Team Details' },
    { key: 'roster', label: 'Roster' },
    { key: 'analytics', label: 'Analytics' },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Page header — back link inline with centered team name */}
      <div className="mb-6">
        {editingTeamInfo ? (
          <>
            <Link href={`/${league}/${season}/teams`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm block mb-3">
              ← Back to Teams
            </Link>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">City / Location</label>
                <input
                  type="text"
                  value={teamInfoDraft.location}
                  onChange={(e) => setTeamInfoDraft(d => ({ ...d, location: e.target.value }))}
                  placeholder="e.g. New York"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">Team Nickname</label>
                <input
                  type="text"
                  value={teamInfoDraft.nickname}
                  onChange={(e) => setTeamInfoDraft(d => ({ ...d, nickname: e.target.value }))}
                  placeholder="e.g. Yankees"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">Stadium</label>
              <input
                type="text"
                value={teamInfoDraft.stadium}
                onChange={(e) => setTeamInfoDraft(d => ({ ...d, stadium: e.target.value }))}
                placeholder="e.g. Yankee Stadium"
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            {teamInfoError && <p className="text-red-600 dark:text-red-400 text-sm mb-2">{teamInfoError}</p>}
            <div className="flex gap-2">
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
                    setTeam(t => t ? { ...t, ...info } : t);
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
                className="text-sm px-4 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
            </div>
          </>
        ) : (
          <div className="relative flex items-center justify-center min-h-[2.5rem]">
            {/* Back arrow */}
            <Link
              href={`/${league}/${season}/teams`}
              className="absolute left-0 p-1.5 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Back to Teams"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4l-6 6 6 6"/>
              </svg>
            </Link>

            {/* Team name */}
            <div className="text-center px-10 sm:px-16">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white leading-tight">
                {teamInfo.location && <span>{teamInfo.location} </span>}
                {teamInfo.nickname || <span className="text-gray-400 italic">Unnamed Team</span>}
              </h1>
              {teamInfo.stadium && (
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">🏟️ {teamInfo.stadium}</p>
              )}
            </div>

            {/* Pencil icon */}
            {(isOwner || isAdmin) && (
              <button
                onClick={() => { setTeamInfoDraft(teamInfo); setEditingTeamInfo(true); setTeamInfoError(''); }}
                className="absolute right-0 p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Edit team info"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-8">
        <nav className="flex gap-0 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'details' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Team Owners</h2>
            {isOwner && (
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
                className="text-xs text-purple-600 hover:text-purple-800 dark:text-purple-400 underline underline-offset-2"
              >
                + Co-owner
              </button>
            )}
          </div>

          {teamOwners.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              {teamOwners.map((owner, idx) => (
                <div key={idx} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900 dark:text-white">{owner.name || 'Unknown Owner'}</p>
                    {owner.verified && <span className="text-green-600 dark:text-green-400 text-xl">✓</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No owner information available.</p>
          )}

          {/* Co-owner modal */}
          {showCoOwnerModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Add Co-owner</h2>
                  <button onClick={() => setShowCoOwnerModal(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>
                </div>

                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Current Owners</p>
                  <div className="space-y-1">
                    {teamOwners.map((o) => (
                      <div key={o.userId} className="flex items-center justify-between text-sm px-3 py-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg gap-2">
                        <span className="font-medium text-gray-800 dark:text-gray-100">{o.name}</span>
                        {teamOwners.length > 1 && (
                          <button
                            disabled={removingCoOwner === o.userId}
                            onClick={async () => {
                              setRemovingCoOwner(o.userId ?? null);
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
                      if (teamOwners.some((o) => o.userId === u.userId)) return false;
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
                    if (teamOwners.some((o) => o.userId === u.userId)) return false;
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
      )}

      {activeTab === 'roster' && <TeamRosterPage embedded={true} />}
      {activeTab === 'analytics' && <TeamAnalyticsPage embedded={true} />}
    </div>
  );
}
