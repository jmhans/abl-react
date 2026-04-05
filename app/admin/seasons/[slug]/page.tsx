'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Team {
  _id: string;
  name: string;
  abbrev: string;
}

interface Season {
  _id: string;
  year: number;
  leagueId: string;
  slug: string;
  teamIds: string[];
}

interface League {
  _id: string;
  name: string;
  slug: string;
}

export default function SeasonDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<Season | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);

  // CSV import state
  const [csvContent, setCsvContent] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [previewGames, setPreviewGames] = useState<any[]>([]);

  // Parse slug to extract league and year
  const parseSlug = (slug: string) => {
    const parts = slug.split('-');
    const year = parseInt(parts[parts.length - 1], 10);
    const leagueSlug = parts.slice(0, -1).join('-');
    return { leagueSlug, year };
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { leagueSlug, year } = parseSlug(slug);

        // Fetch leagues to find the ID
        const leaguesRes = await fetch('/api/leagues');
        const leagues = await leaguesRes.json();
        const foundLeague = leagues.find((l: League) => l.slug === leagueSlug);

        if (!foundLeague) {
          throw new Error('League not found');
        }

        setLeague(foundLeague);

        // Fetch seasons
        const seasonsRes = await fetch('/api/seasons');
        const seasons = await seasonsRes.json();
        const foundSeason = seasons.find(
          (s: Season) => s.leagueId === foundLeague._id && s.year === year
        );

        if (!foundSeason) {
          throw new Error('Season not found');
        }

        setSeason(foundSeason);

        // Fetch teams
        const teamsRes = await fetch(
          `/api/teams?seasonId=${foundSeason._id}`
        );
        const teamsData = await teamsRes.json();
        setTeams(Array.isArray(teamsData) ? teamsData : []);
      } catch (error) {
        setImportError(
          error instanceof Error ? error.message : 'Failed to load season'
        );
      } finally {
        setLoading(false);
      }
    };

    if (slug) load();
  }, [slug]);

  const handleCsvChange = (content: string) => {
    setCsvContent(content);
    setPreviewGames([]);
    setImportError('');
  };

  const previewCsv = () => {
    setImportError('');
    setPreviewGames([]);

    const lines = csvContent.trim().split('\n');
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

      const team1 = teams.find(t => 
        t.name.toLowerCase() === team1Name.toLowerCase() || 
        t.abbrev.toLowerCase() === team1Name.toLowerCase()
      );
      const team2 = teams.find(t => 
        t.name.toLowerCase() === team2Name.toLowerCase() || 
        t.abbrev.toLowerCase() === team2Name.toLowerCase()
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
      if (isNaN(gameDate.getTime())) {
        setImportError(`Line ${i + 1}: Invalid date "${dateName}"`);
        return;
      }

      preview.push({
        awayTeam: team1Name,
        homeTeam: team2Name,
        gameDate: dateName,
        parsedDate: gameDate.toDateString(),
      });
    }

    setPreviewGames(preview);
  };

  const handleImport = async () => {
    if (previewGames.length === 0) {
      setImportError('Please preview the CSV first');
      return;
    }

    if (!season || !league) {
      setImportError('Season not loaded');
      return;
    }

    setImporting(true);
    setImportError('');
    setImportSuccess('');

    try {
      const res = await fetch(
        `/api/games/import-schedule?league=${league.slug}&season=${season.year}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv: csvContent }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.error || 'Import failed';
        const details = data.errors || data.duplicates || [];
        setImportError(
          errorMsg + (details.length > 0 ? ': ' + details.join(', ') : '')
        );
      } else {
        setImportSuccess(`✓ Imported ${data.created} games successfully`);
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
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!season || !league) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-4">
        <Link href="/admin/seasons" className="text-sm text-blue-600 hover:text-blue-800 inline-block">
          ← Back to Seasons
        </Link>
        <p className="text-red-600">{importError || 'Season not found'}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-10">
      <div>
        <Link href="/admin/seasons" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Back to Seasons
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          {league.name} {season.year}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {teams.length} teams · Season ID: {season._id}
        </p>
      </div>

      {/* Import Schedule Section */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">Import Game Schedule</h2>
        
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-900 space-y-2">
          <p className="font-medium">CSV Format</p>
          <p className="font-mono text-xs bg-blue-100 px-2 py-1 rounded">
            Team 1 | Team 2 | YYYY-MM-DD
          </p>
          <p>Use team names or abbreviations. One game per line.</p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700 mb-2 block">
              Paste CSV data
            </span>
            <textarea
              value={csvContent}
              onChange={(e) => handleCsvChange(e.target.value)}
              placeholder="Team1 | Team2 | 2026-04-01&#10;Team3 | Team4 | 2026-04-02"
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
            </div>
          </div>
        )}
      </section>

      {/* Teams Section */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">Teams in this season</h2>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-2 gap-px bg-gray-100">
            {teams.map((team) => (
              <div key={team._id} className="bg-white px-4 py-2 text-sm">
                <span className="font-medium">{team.name}</span>
                {team.abbrev && (
                  <span className="text-gray-400 ml-2">({team.abbrev})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
