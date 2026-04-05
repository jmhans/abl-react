'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Team {
  _id: string;
  nickname?: string;
  location?: string;
  stadium?: string;
  owners?: { name?: string; userId?: string }[];
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
  const [activeSeasonYear, setActiveSeasonYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // team checkbox selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [teamsSaving, setTeamsSaving] = useState(false);
  const [teamsMsg, setTeamsMsg] = useState('');

  // status toggle
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // schedule import state
  const [csvContent, setCsvContent] = useState('');
  const [previewGames, setPreviewGames] = useState<Array<{ homeTeam: string; awayTeam: string; gameDate: string; parsedDate: string }>>([]);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [importing, setImporting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [seasonRes, teamsRes] = await Promise.all([
      fetch(`/api/seasons/${id}`).then((r) => r.json()),
      fetch('/api/teams').then((r) => r.json()),
    ]);

    if (!seasonRes.error) {
      // Normalise: isActive may be missing on older season docs — derive from status
      const normalised = {
        ...seasonRes,
        isActive: seasonRes.isActive ?? (seasonRes.status === 'active'),
      };
      setSeason(normalised);
      const ids = (seasonRes.teamIds ?? []).map((tid: any) => tid.toString());
      setSelected(new Set(ids));

      // Fetch the active season for this league so the link always targets it
      if (seasonRes.league?.slug) {
        const activeRes = await fetch(
          `/api/seasons?league=${seasonRes.league.slug}&status=active`
        ).then((r) => r.json()).catch(() => []);
        const activeSeason = Array.isArray(activeRes) ? activeRes[0] : null;
        setActiveSeasonYear(activeSeason?.year ?? null);
      }
    } else {
      setSeason(null);
    }
    const teams: Team[] = Array.isArray(teamsRes) ? teamsRes : [];
    setAllTeams(teams);
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

  const setStatus = async (newStatus: 'pre-draft' | 'active' | 'completed') => {
    if (!season) return;
    setStatusMsg('');
    setStatusSaving(true);
    const newActive = newStatus !== 'completed';
    try {
      const res = await fetch(`/api/seasons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newActive, status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) setStatusMsg(`Error: ${data.error}`);
      else {
        setSeason((prev) => prev ? { ...prev, isActive: data.isActive, status: data.status } : prev);
        setStatusMsg(`Status set to "${newStatus}".`);
      }
    } catch {
      setStatusMsg('Network error');
    } finally {
      setStatusSaving(false);
    }
  };

  const teamLabel = (t: Team) => {
    const name = t.location && t.nickname
      ? `${t.location} ${t.nickname}`
      : t.nickname ?? t.location ?? '(unnamed)';
    const ownerNames = (t.owners ?? []).map(o => o.name).filter(Boolean).join(', ');
    return ownerNames ? `${name} — ${ownerNames}` : name;
  };

  const handleCsvChange = (content: string) => {
    setCsvContent(content);
    setPreviewGames([]);
    setImportError('');
  };

  const previewCsv = () => {
    setImportError('');
    setPreviewGames([]);

    const lines = csvContent.trim().split('\n');
<<<<<<< HEAD
    const preview: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split('|').map(p => p.trim());

      if (parts.length < 3) {
        setImportError(`Line ${i + 1}: Invalid format (expected team1 | team2 | date)`);
        return;
      }

      const team1Name = parts[0];
      const team2Name = parts[1];
      const dateName = parts[2];

      const team1 = allTeams.find(t => 
        t.location?.toLowerCase() === team1Name.toLowerCase() || 
        t.nickname?.toLowerCase() === team1Name.toLowerCase()
      );
      const team2 = allTeams.find(t => 
        t.location?.toLowerCase() === team2Name.toLowerCase() || 
        t.nickname?.toLowerCase() === team2Name.toLowerCase()
      );

      if (!team1) {
        setImportError(`Line ${i + 1}: Team "${team1Name}" not found`);
        return;
      }
      if (!team2) {
        setImportError(`Line ${i + 1}: Team "${team2Name}" not found`);
        return;
      }

      const gameDate = new Date(dateName);
=======
    const preview: Array<{ homeTeam: string; awayTeam: string; gameDate: string; parsedDate: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      const parts = line.split(',').map(p => p.trim());

      if (parts.length < 3) {
        setImportError(`Line ${i + 1}: Invalid format (expected homeTeam, awayTeam, date)`);
        return;
      }

      const homeTeamName = parts[0];
      const awayTeamName = parts[1];
      const dateName = parts[2];

      // Find teams by nickname or location
      const homeTeam = allTeams.find(t => 
        t.nickname?.toLowerCase() === homeTeamName.toLowerCase() || 
        t.location?.toLowerCase() === homeTeamName.toLowerCase()
      );
      const awayTeam = allTeams.find(t => 
        t.nickname?.toLowerCase() === awayTeamName.toLowerCase() || 
        t.location?.toLowerCase() === awayTeamName.toLowerCase()
      );

      if (!homeTeam) {
        setImportError(`Line ${i + 1}: Home team "${homeTeamName}" not found`);
        return;
      }
      if (!awayTeam) {
        setImportError(`Line ${i + 1}: Away team "${awayTeamName}" not found`);
        return;
      }

      // Validate date format YYYY-MM-DD
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateName)) {
        setImportError(`Line ${i + 1}: Invalid date format "${dateName}" (use YYYY-MM-DD)`);
        return;
      }

      const gameDate = new Date(dateName + 'T00:00:00Z');
>>>>>>> c3c5300 (feat: add schedule import with timezone conversion and season/league scoping)
      if (isNaN(gameDate.getTime())) {
        setImportError(`Line ${i + 1}: Invalid date "${dateName}"`);
        return;
      }

<<<<<<< HEAD
      preview.push({
        awayTeam: team1Name,
        homeTeam: team2Name,
        gameDate: dateName,
        parsedDate: gameDate.toDateString(),
      });
    }

    setPreviewGames(preview);
  };

=======
      // Convert to noon CT UTC for display
      const utcNoonCT = convertToNoonCT(dateName);
      const utcDate = new Date(utcNoonCT);

      preview.push({
        homeTeam: homeTeamName,
        awayTeam: awayTeamName,
        gameDate: dateName,
        parsedDate: utcDate.toUTCString(), // Show UTC time
      });
    }

    if (preview.length === 0) {
      setImportError('No valid games found in CSV');
      return;
    }

    setPreviewGames(preview);
  };

  const convertToNoonCT = (dateStr: string): string => {
    // Parse YYYY-MM-DD and create a date for noon CT
    const [year, month, day] = dateStr.split('-').map(Number);
    
    // Create a date in CT timezone for noon on that date
    // We'll use Intl API to handle timezone conversion reliably
    const date = new Date(year, month - 1, day, 12, 0, 0); // 12:00 PM in local timezone
    
    // Get the offset between UTC and CT for this date
    // Create a formatter for CT timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(date);
    const partMap = new Map(parts.map(p => [p.type, p.value]));
    
    // Create UTC date from local date components
    const localDate = new Date(
      parseInt(partMap.get('year')!),
      parseInt(partMap.get('month')!) - 1,
      parseInt(partMap.get('day')!),
      parseInt(partMap.get('hour')!),
      parseInt(partMap.get('minute')!),
      parseInt(partMap.get('second')!)
    );
    
    // Calculate offset
    const utcDate = new Date(date.getTime() - (date.getTime() - localDate.getTime()));
    return utcDate.toISOString();
  };

>>>>>>> c3c5300 (feat: add schedule import with timezone conversion and season/league scoping)
  const handleImport = async () => {
    if (previewGames.length === 0) {
      setImportError('Please preview the CSV first');
      return;
    }

<<<<<<< HEAD
    if (!season || !season.league) {
=======
    if (!season) {
>>>>>>> c3c5300 (feat: add schedule import with timezone conversion and season/league scoping)
      setImportError('Season not loaded');
      return;
    }

    setImporting(true);
    setImportError('');
    setImportSuccess('');

    try {
<<<<<<< HEAD
      const res = await fetch(
        `/api/games/import-schedule?league=${season.league.slug}&season=${season.year}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv: csvContent }),
        }
      );
=======
      // Convert preview games to API format
      const gamesToCreate = previewGames.map(previewGame => {
        // Find the teams again to get their ObjectIds
        const homeTeam = allTeams.find(t => 
          t.nickname?.toLowerCase() === previewGame.homeTeam.toLowerCase() || 
          t.location?.toLowerCase() === previewGame.homeTeam.toLowerCase()
        );
        const awayTeam = allTeams.find(t => 
          t.nickname?.toLowerCase() === previewGame.awayTeam.toLowerCase() || 
          t.location?.toLowerCase() === previewGame.awayTeam.toLowerCase()
        );

        return {
          homeTeam: homeTeam?._id,
          awayTeam: awayTeam?._id,
          gameDate: convertToNoonCT(previewGame.gameDate),
          gameType: 'R',
          seasonId: season._id,
          leagueId: season.leagueId
        };
      });

      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gamesToCreate),
      });
>>>>>>> c3c5300 (feat: add schedule import with timezone conversion and season/league scoping)

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.error || 'Import failed';
<<<<<<< HEAD
        const details = data.errors || data.duplicates || [];
        setImportError(
          errorMsg + (details.length > 0 ? ': ' + details.join(', ') : '')
        );
      } else {
        setImportSuccess(`✓ Imported ${data.created} games successfully`);
=======
        setImportError(errorMsg);
      } else {
        setImportSuccess(`✓ Imported ${previewGames.length} games successfully`);
>>>>>>> c3c5300 (feat: add schedule import with timezone conversion and season/league scoping)
        setCsvContent('');
        setPreviewGames([]);
      }
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : 'Network error'
      );
    } finally {
      setImporting(false);
    }
  };

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

  const liveHref = season?.league && activeSeasonYear
    ? `/${season.league.slug}/${activeSeasonYear}`
    : null;

  const isViewingSeason = season?.year === activeSeasonYear;

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
                {isViewingSeason ? 'View live season ↗' : `Go to active season (${activeSeasonYear}) ↗`}
              </Link>
            )}
            <span
              className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                season.status === 'pre-draft' ? 'bg-yellow-100 text-yellow-700' :
                season.status === 'active' ? 'bg-green-100 text-green-700' :
                'bg-gray-100 text-gray-500'
              }`}
            >
              {season.status === 'pre-draft' ? 'Pre-Draft' :
               season.status === 'active' ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* Status toggle */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Season Status</h2>
        <p className="text-sm text-gray-500">
          Currently{' '}
          <strong className={season.status === 'pre-draft' ? 'text-yellow-700' : season.status === 'active' ? 'text-green-700' : 'text-gray-700'}>
            {season.status === 'pre-draft' ? 'pre-draft' : season.status === 'active' ? 'active' : 'completed'}
          </strong>
          . Lifecycle: <span className="font-mono text-xs">pre-draft → active → completed</span>
        </p>
        {statusMsg && (
          <p className={`text-sm ${statusMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {statusMsg}
          </p>
        )}
        {season.status === 'pre-draft' && (
          <button
            onClick={() => setStatus('active')}
            disabled={statusSaving}
            className="rounded-lg px-5 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {statusSaving ? 'Saving…' : 'Mark Active (Draft Complete)'}
          </button>
        )}
        {season.status === 'active' && (
          <button
            onClick={() => setStatus('completed')}
            disabled={statusSaving}
            className="rounded-lg px-5 py-2.5 text-sm font-medium text-white bg-gray-500 hover:bg-gray-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {statusSaving ? 'Saving…' : 'Mark as Completed'}
          </button>
        )}
        {season.status === 'completed' && (
          <button
            onClick={() => setStatus('pre-draft')}
            disabled={statusSaving}
            className="rounded-lg px-5 py-2.5 text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {statusSaving ? 'Saving…' : 'Re-open as Pre-Draft'}
          </button>
        )}
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

<<<<<<< HEAD
      {/* Import Schedule Section */}
=======
      {/* Schedule import */}
>>>>>>> c3c5300 (feat: add schedule import with timezone conversion and season/league scoping)
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">Import Game Schedule</h2>
        
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-900 space-y-2">
          <p className="font-medium">CSV Format</p>
          <p className="font-mono text-xs bg-blue-100 px-2 py-1 rounded">
<<<<<<< HEAD
            Team 1 | Team 2 | YYYY-MM-DD
          </p>
          <p>Use team names or locations. One game per line.</p>
=======
            homeTeam, awayTeam, YYYY-MM-DD
          </p>
          <p>Use team nicknames or locations. Games will start at <strong>12:00 PM CT (UTC)</strong>. One game per line.</p>
>>>>>>> c3c5300 (feat: add schedule import with timezone conversion and season/league scoping)
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700 mb-2 block">
              Paste CSV data
            </span>
            <textarea
              value={csvContent}
              onChange={(e) => handleCsvChange(e.target.value)}
<<<<<<< HEAD
              placeholder="Team1 | Team2 | 2026-04-01&#10;Team3 | Team4 | 2026-04-02"
=======
              placeholder="Team A, Team B, 2026-04-01&#10;Team C, Team D, 2026-04-02"
>>>>>>> c3c5300 (feat: add schedule import with timezone conversion and season/league scoping)
              className="w-full h-32 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </label>

          <div className="flex gap-3">
            <button
              onClick={previewCsv}
              disabled={!csvContent.trim()}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Preview
            </button>
            <button
              onClick={handleImport}
              disabled={importing || previewGames.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>

        {importError && (
          <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-sm text-red-900">
            {importError}
          </div>
        )}

        {importSuccess && (
          <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 text-sm text-green-900">
            {importSuccess}
          </div>
        )}

        {previewGames.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">
              Preview: {previewGames.length} games
            </p>
<<<<<<< HEAD
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y">
              {previewGames.map((game, idx) => (
                <div
                  key={idx}
                  className="px-4 py-3 text-sm flex items-center justify-between"
                >
                  <div className="font-mono">
                    <span className="font-medium">{game.awayTeam}</span>
                    <span className="text-gray-400"> @ </span>
                    <span className="font-medium">{game.homeTeam}</span>
                  </div>
                  <span className="text-gray-500 text-xs">{game.parsedDate}</span>
                </div>
              ))}
=======
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm text-gray-700">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Home Team</th>
                    <th className="text-left px-4 py-2 font-medium">Away Team</th>
                    <th className="text-left px-4 py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {previewGames.map((game, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-2">{game.homeTeam}</td>
                      <td className="px-4 py-2">{game.awayTeam}</td>
                      <td className="px-4 py-2 text-gray-500">{game.parsedDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
>>>>>>> c3c5300 (feat: add schedule import with timezone conversion and season/league scoping)
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
