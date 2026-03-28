'use client';

import { useState } from 'react';
import Link from 'next/link';

interface TeamScoreDiff {
  team: string | null;
  location: string | null;
  storedRegulation: number | null;
  recalculatedRegulation: number | null;
  storedFinal: number | null;
  recalculatedFinal: number | null;
  storedRegulationDetail?: { abl_runs: number | null; abl_points: number | null; ab: number | null; opp_e: number | null; opp_pb: number | null } | null;
  recalculatedRegulationDetail?: { abl_runs: number | null; abl_points: number | null; ab: number | null; opp_e: number | null; opp_pb: number | null } | null;
  storedFinalDetail?: { abl_runs: number | null; abl_points: number | null; ab: number | null; opp_e: number | null; opp_pb: number | null } | null;
  recalculatedFinalDetail?: { abl_runs: number | null; abl_points: number | null; ab: number | null; opp_e: number | null; opp_pb: number | null } | null;
  activePlayerDiff?: {
    changedCount: number;
    addedCount: number;
    removedCount: number;
    changed: Array<{ key: string; name: string | null; storedPlayedPosition: string | null; recalculatedPlayedPosition: string | null }>;
    added: Array<{ key: string; name: string | null; recalculatedPlayedPosition: string | null }>;
    removed: Array<{ key: string; name: string | null; storedPlayedPosition: string | null }>;
  };
  storedActiveLineup?: Array<{ key: string | null; name: string | null; playedPosition: string | null; lineupPosition: string | null; lineupOrder: number | null; abl_points: number | null; ab: number | null; g: number | null }>;
  recalculatedActiveLineup?: Array<{ key: string | null; name: string | null; playedPosition: string | null; lineupPosition: string | null; lineupOrder: number | null; abl_points: number | null; ab: number | null; g: number | null }>;
}

interface GameScoreDiff {
  gameId: string;
  gameDate?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeTeam?: string;
  awayTeam?: string;
  scoreComparison: {
    regulationDiffTeams: number;
    finalDiffTeams: number;
    winnerChanged: boolean;
    teams: TeamScoreDiff[];
  };
}

interface AuditResult {
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  scoreSummary?: {
    gamesCompared?: number;
    gamesWithDiffs?: number;
    regulationDiffTeams?: number;
    finalDiffTeams?: number;
    winnerDiffGames?: number;
  };
  summary?: Array<any>;
  error?: string;
}

function renderDetail(d: { abl_runs: number | null; abl_points: number | null; ab: number | null; opp_e: number | null; opp_pb: number | null } | null | undefined) {
  if (!d) return '—';
  return `runs ${d.abl_runs ?? '—'}, pts ${d.abl_points ?? '—'}, ab ${d.ab ?? '—'}, oppE ${d.opp_e ?? '—'}, oppPB ${d.opp_pb ?? '—'}`;
}

export default function ScoreAuditPage() {
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [limit, setLimit] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [diffs, setDiffs] = useState<GameScoreDiff[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    setDiffs([]);
    setError(null);
    try {
      const payload: Record<string, unknown> = { compareScores: true, save: false };
      if (dateStart) payload.dateStart = `${dateStart}T00:00:00.000Z`;
      if (dateEnd) payload.dateEnd = `${dateEnd}T23:59:59.999Z`;
      const parsedLimit = Number(limit);
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) payload.limit = parsedLimit;

      const res = await fetch('/api/games/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: AuditResult = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Audit failed');
      setResult(data);
      setDiffs((data.summary || []).filter((g: any) => g?.scoreComparison?.hasDiffs));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Audit failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Score Audit</h1>
        <p className="text-gray-500 text-sm mt-1">
          Read-only recalculation that compares stored vs recalculated scores. Nothing is saved.
          Leave dates blank to audit all games up to the limit.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="Start date (optional)"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="End date (optional)"
          />
          <input
            type="number"
            min="1"
            step="1"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-violet-500"
            title="Max games to audit"
          />
          <button
            onClick={run}
            disabled={busy}
            className="rounded-lg bg-violet-700 px-5 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Auditing…' : 'Run Audit'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">{error}</div>
        )}

        {result?.scoreSummary && (
          <div className="rounded-lg bg-violet-50 border border-violet-200 px-4 py-3 text-sm text-violet-900 space-y-1">
            <div className="font-medium">
              Compared {result.scoreSummary.gamesCompared ?? 0} games &bull;{' '}
              {result.scoreSummary.gamesWithDiffs ?? 0} with diffs
            </div>
            <div>
              Regulation team diffs: {result.scoreSummary.regulationDiffTeams ?? 0} &bull;{' '}
              Final team diffs: {result.scoreSummary.finalDiffTeams ?? 0} &bull;{' '}
              Winner changed: {result.scoreSummary.winnerDiffGames ?? 0}
            </div>
            <div className="text-violet-600">
              Processed {result.processed} &bull; Skipped {result.skipped} &bull; Errors {result.errors}
            </div>
          </div>
        )}
      </div>

      {diffs.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-900">Games with Score Diffs ({diffs.length})</h2>
          {diffs.map((game) => (
            <div key={game.gameId} className="bg-white rounded-xl shadow-sm border border-violet-200 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-gray-900">
                  {game.awayTeamName || game.awayTeam || 'Away'} @ {game.homeTeamName || game.homeTeam || 'Home'}
                </div>
                <Link href={`/games/${game.gameId}`} className="text-sm text-blue-600 hover:text-blue-800">
                  Open Game →
                </Link>
              </div>
              <div className="text-xs text-gray-500">
                {game.gameDate ? new Date(game.gameDate).toLocaleString() : game.gameId}
              </div>
              <div className="text-xs text-violet-800">
                Regulation diffs: {game.scoreComparison.regulationDiffTeams} &bull;{' '}
                Final diffs: {game.scoreComparison.finalDiffTeams} &bull;{' '}
                Winner changed: {game.scoreComparison.winnerChanged ? 'yes' : 'no'}
              </div>
              <div className="space-y-2">
                {(game.scoreComparison.teams || []).map((team, idx) => (
                  <div key={`${game.gameId}-${team.location || idx}`} className="text-xs text-gray-600 space-y-0.5 pl-2 border-l-2 border-violet-100">
                    <div className="font-medium text-gray-700">{team.location || 'Team'}</div>
                    <div>
                      Reg: {team.storedRegulation ?? '—'} → {team.recalculatedRegulation ?? '—'} &nbsp;
                      Final: {team.storedFinal ?? '—'} → {team.recalculatedFinal ?? '—'}
                    </div>
                    <div className="text-gray-400">
                      Reg detail: [{renderDetail(team.storedRegulationDetail)}] → [{renderDetail(team.recalculatedRegulationDetail)}]
                    </div>
                    <div className="text-gray-400">
                      Final detail: [{renderDetail(team.storedFinalDetail)}] → [{renderDetail(team.recalculatedFinalDetail)}]
                    </div>
                    {team.activePlayerDiff && (team.activePlayerDiff.changedCount + team.activePlayerDiff.addedCount + team.activePlayerDiff.removedCount) > 0 && (
                      <div className="text-amber-700">
                        Active player diffs: changed {team.activePlayerDiff.changedCount}, added {team.activePlayerDiff.addedCount}, removed {team.activePlayerDiff.removedCount}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
