'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLeagueSeason, leagueSeasonQuery } from '@/app/lib/league-season-context';
import BracketSeries, { type SeriesView } from './BracketSeries';
import TiebreakPanel, { type TiebreakGroupView } from './TiebreakPanel';

interface BracketResponse {
  status: string;
  seeds?: { seed: number; team: { _id: string; nickname: string; location?: string } | null }[];
  tiebreaks?: TiebreakGroupView[];
  series?: SeriesView[];
}

const SERIES_TITLES: Record<string, string> = {
  'R1-1v4': '1 vs 4',
  'R1-2v3': '2 vs 3',
  CHAMP: 'World Series',
  THIRD: '3rd Place',
};

export default function PlayoffsPage() {
  const ctx = useLeagueSeason();
  const { league, season } = ctx;
  const seasonQuery = useMemo(() => leagueSeasonQuery(ctx), [ctx]);

  const [bracket, setBracket] = useState<BracketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/playoffs/bracket?${seasonQuery}`);
        if (!res.ok) throw new Error('Failed to load playoff bracket');
        setBracket(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load playoff bracket');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [seasonQuery]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading playoffs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-600">{error}</div>
      </div>
    );
  }

  const firstRound = (bracket?.series ?? []).filter((s) => s.round === 'first');
  const secondRound = (bracket?.series ?? []).filter((s) => s.round === 'second');
  const champion = secondRound.find((s) => s.seriesId === 'CHAMP' && s.status === 'complete')?.winnerTeam;

  return (
    <div className="w-full px-3 py-6 md:px-4 md:py-8 max-w-4xl mx-auto">
      <div className="mb-6 md:mb-8">
        <Link href={`/${league}/${season}`} className="text-blue-600 hover:text-blue-800 mb-3 md:mb-4 inline-block text-sm md:text-base">
          ← Back to Home
        </Link>
        <h1 className="text-2xl md:text-4xl font-bold text-gray-900">Playoffs</h1>
      </div>

      {(!bracket || bracket.status === 'not_started') && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center text-gray-600">
          Playoffs begin once the regular season concludes.
        </div>
      )}

      {bracket && bracket.status === 'awaiting_regular_season_end' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center text-gray-600">
          Regular season is still in progress — seeding will be determined once it wraps up.
        </div>
      )}

      {champion && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          <span className="text-lg font-semibold text-yellow-800">
            🏆 Champion: {[champion.location, champion.nickname].filter(Boolean).join(' ')}
          </span>
        </div>
      )}

      {bracket?.seeds && bracket.seeds.length > 0 && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-800 mb-2">Seeds</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {bracket.seeds.map((s) => (
              <div key={s.seed}>
                <span className="text-gray-400">#{s.seed}</span>{' '}
                <span className="text-gray-800">{s.team ? [s.team.location, s.team.nickname].filter(Boolean).join(' ') : 'TBD'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {bracket?.tiebreaks && bracket.tiebreaks.length > 0 && (
        <div className="mb-6">
          <TiebreakPanel tiebreaks={bracket.tiebreaks} />
        </div>
      )}

      {firstRound.length > 0 && (
        <div className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3">First Round</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {firstRound.map((s) => (
              <BracketSeries key={s.seriesId} series={s} title={SERIES_TITLES[s.seriesId] ?? s.seriesId} league={league} season={season} />
            ))}
          </div>
        </div>
      )}

      {secondRound.length > 0 && (
        <div className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3">Championship &amp; 3rd Place</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {secondRound.map((s) => (
              <BracketSeries key={s.seriesId} series={s} title={SERIES_TITLES[s.seriesId] ?? s.seriesId} league={league} season={season} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
