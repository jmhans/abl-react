'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Team {
  _id: string;
  tm?: string;
  teamName?: string;
  owner?: string;
}

interface League {
  _id: string;
  name: string;
  slug: string;
}

interface Season {
  _id: string;
  leagueId: string;
  year: number;
  slug: string;
  status: string;
  isActive: boolean;
  teamIds: string[];
  league?: League;
  teams?: Team[];
}

export default function AdminSeasonDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [season, setSeason] = useState<Season | null>(null);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  // team checkbox selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [teamsSaving, setTeamsSaving] = useState(false);
  const [teamsMsg, setTeamsMsg] = useState('');

  // status toggle
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const load = async () => {
    setLoading(true);
    const [seasonRes, teamsRes] = await Promise.all([
      fetch(`/api/seasons/${id}`).then((r) => r.json()),
      fetch('/api/teams').then((r) => r.json()),
    ]);

    setSeason(seasonRes.error ? null : seasonRes);
    const teams: Team[] = Array.isArray(teamsRes) ? teamsRes : [];
    setAllTeams(teams);
    if (!seasonRes.error) {
      const ids = (seasonRes.teamIds ?? []).map((tid: any) => tid.toString());
      setSelected(new Set(ids));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTeam = (teamId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(teamId) ? next.delete(teamId) : next.add(teamId);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(allTeams.map((t) => t._id.toString())));
  const clearAll = () => setSelected(new Set());

  const saveTeams = async () => {
    setTeamsMsg('');
    setTeamsSaving(true);
    try {
      const res = await fetch(`/api/seasons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) setTeamsMsg(`Error: ${data.error}`);
      else {
        setTeamsMsg(`Saved — ${selected.size} teams in season.`);
        setSeason((prev) => prev ? { ...prev, teamIds: data.teamIds } : prev);
      }
    } catch {
      setTeamsMsg('Network error');
    } finally {
      setTeamsSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!season) return;
    setStatusMsg('');
    setStatusSaving(true);
    const newActive = !season.isActive;
    try {
      const res = await fetch(`/api/seasons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newActive, status: newActive ? 'active' : 'completed' }),
      });
      const data = await res.json();
      if (!res.ok) setStatusMsg(`Error: ${data.error}`);
      else {
        setSeason((prev) => prev ? { ...prev, isActive: data.isActive, status: data.status } : prev);
        setStatusMsg(`Season marked ${newActive ? 'active' : 'completed'}.`);
      }
    } catch {
      setStatusMsg('Network error');
    } finally {
      setStatusSaving(false);
    }
  };

  const teamLabel = (t: Team) =>
    [t.teamName ?? t.tm ?? '(unnamed)', t.owner ? `— ${t.owner}` : '']
      .filter(Boolean)
      .join(' ');

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!season) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-4">
        <Link href="/admin/seasons" className="text-sm text-blue-600 hover:text-blue-800">
          ← Seasons
        </Link>
        <p className="text-red-600">Season not found.</p>
      </div>
    );
  }

  const liveHref = season.league
    ? `/${season.league.slug}/${season.year}`
    : null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-10">
      {/* Header */}
      <div>
        <Link href="/admin/seasons" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Seasons
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {season.league?.name ?? 'Unknown League'} — {season.year} Season
            </h1>
            <p className="text-gray-500 text-sm mt-1 font-mono">
              /{season.league?.slug ?? '?'}/{season.year}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {liveHref && (
              <Link
                href={liveHref}
                target="_blank"
                className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5"
              >
                View live season ↗
              </Link>
            )}
            <span
              className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                season.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {season.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* Status toggle */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Season Status</h2>
        <p className="text-sm text-gray-500">
          Currently{' '}
          <strong>{season.isActive ? 'active' : season.status ?? 'inactive'}</strong>.
          Marking a season active determines the default for the &quot;/abl/…&quot; links.
        </p>
        {statusMsg && (
          <p className={`text-sm ${statusMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {statusMsg}
          </p>
        )}
        <button
          onClick={toggleActive}
          disabled={statusSaving}
          className={`rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed ${
            season.isActive
              ? 'bg-gray-500 hover:bg-gray-600'
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {statusSaving
            ? 'Saving…'
            : season.isActive
            ? 'Mark as Completed'
            : 'Mark as Active'}
        </button>
      </section>

      {/* Team assignment */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">Teams in Season</h2>
          <div className="flex gap-2 text-sm">
            <button onClick={selectAll} className="text-blue-600 hover:text-blue-800">
              Select all
            </button>
            <span className="text-gray-300">|</span>
            <button onClick={clearAll} className="text-gray-500 hover:text-gray-700">
              Clear all
            </button>
          </div>
        </div>

        <p className="text-sm text-gray-500">
          {selected.size} of {allTeams.length} teams selected
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {allTeams.map((team) => {
            const tid = team._id.toString();
            return (
              <label
                key={tid}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                  selected.has(tid)
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(tid)}
                  onChange={() => toggleTeam(tid)}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-800">{teamLabel(team)}</span>
              </label>
            );
          })}
        </div>

        {teamsMsg && (
          <p className={`text-sm ${teamsMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {teamsMsg}
          </p>
        )}

        <button
          onClick={saveTeams}
          disabled={teamsSaving}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {teamsSaving ? 'Saving…' : 'Save Team Roster'}
        </button>
      </section>
    </div>
  );
}
