'use client';

import { useState } from 'react';
import Link from 'next/link';

export interface Team {
  _id: string;
  nickname: string;
  location?: string;
}

export interface GameSummary {
  _id: string;
  homeTeam: string;
  awayTeam: string;
  gameDate: string;
  cancelled?: boolean;
  playoff?: { seriesGameNumber?: number };
  result?: {
    isFinal?: boolean;
    winner?: string;
    scores?: { team: string; final?: { abl_runs?: number }; regulation?: { abl_runs?: number } }[];
  };
}

export interface SeriesView {
  seriesId: string;
  round: 'first' | 'second';
  higherSeedTeam: Team | null;
  lowerSeedTeam: Team | null;
  higherSeedOriginalSeed: number;
  lowerSeedOriginalSeed: number;
  games: GameSummary[];
  status: string;
  winnerTeam: Team | null;
  loserTeam: Team | null;
  clinchedAtGameNumber: number | null;
}

function teamName(team: Team | null): string {
  if (!team) return 'TBD';
  return [team.location, team.nickname].filter(Boolean).join(' ');
}

function runsFor(game: GameSummary, teamId: string): number | null {
  const line = game.result?.scores?.find((s) => s.team === teamId);
  if (!line) return null;
  const runs = line.final?.abl_runs ?? line.regulation?.abl_runs;
  return typeof runs === 'number' ? runs : null;
}

function seriesRecord(series: SeriesView): { higherWins: number; lowerWins: number } {
  let higherWins = 0;
  let lowerWins = 0;
  for (const g of series.games) {
    if (!g.result?.isFinal || g.cancelled) continue;
    if (g.result.winner === series.higherSeedTeam?._id) higherWins++;
    else if (g.result.winner === series.lowerSeedTeam?._id) lowerWins++;
  }
  return { higherWins, lowerWins };
}

export default function BracketSeries({
  series,
  title,
  league,
  season,
}: {
  series: SeriesView;
  title: string;
  league: string;
  season: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { higherWins, lowerWins } = seriesRecord(series);
  const sortedGames = [...series.games].sort(
    (a, b) => (a.playoff?.seriesGameNumber ?? 0) - (b.playoff?.seriesGameNumber ?? 0)
  );

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{title}</span>
      </div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 text-left"
      >
        <div className="space-y-1">
          <div className={`text-sm ${series.winnerTeam?._id === series.higherSeedTeam?._id ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
            #{series.higherSeedOriginalSeed} {teamName(series.higherSeedTeam)}
          </div>
          <div className={`text-sm ${series.winnerTeam?._id === series.lowerSeedTeam?._id ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
            #{series.lowerSeedOriginalSeed} {teamName(series.lowerSeedTeam)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-gray-900">{higherWins}-{lowerWins}</div>
          <div className="text-xs text-gray-500">
            {series.status === 'complete' ? `${teamName(series.winnerTeam)} wins` : series.status === 'in_progress' ? 'In progress' : 'Scheduled'}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {sortedGames.map((g) => {
            if (g.cancelled) return null; // never played (series already clinched) — not worth showing

            const home = runsFor(g, g.homeTeam);
            const away = runsFor(g, g.awayTeam);
            const homeTeam = g.homeTeam === series.higherSeedTeam?._id ? series.higherSeedTeam : series.lowerSeedTeam;
            const awayTeam = g.awayTeam === series.higherSeedTeam?._id ? series.higherSeedTeam : series.lowerSeedTeam;
            const gameNumber = g.playoff?.seriesGameNumber ?? 0;
            const isPlayed = !!g.result?.isFinal;
            // A best-of-7 can't end before game 4, so games 5-7 are only "maybe" needed
            // until they're actually played.
            const ifNecessary = !isPlayed && gameNumber >= 5;
            const homeWon = isPlayed && g.result?.winner === g.homeTeam;
            const awayWon = isPlayed && g.result?.winner === g.awayTeam;

            return (
              <Link
                key={g._id}
                href={`/${league}/${season}/games/${g._id}`}
                className="flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-50"
              >
                <span className="text-gray-500 w-16 shrink-0">Game {gameNumber || '-'}</span>
                {ifNecessary ? (
                  <span className="text-gray-400 flex-1 text-center italic">
                    {teamName(awayTeam)} @ {teamName(homeTeam)} (if necessary)
                  </span>
                ) : (
                  <span className="flex-1 text-center text-gray-700">
                    <span className={awayWon ? 'font-semibold text-gray-900' : undefined}>
                      {teamName(awayTeam)} {away != null ? away.toFixed(2) : '-'}
                    </span>
                    {' @ '}
                    <span className={homeWon ? 'font-semibold text-gray-900' : undefined}>
                      {teamName(homeTeam)} {home != null ? home.toFixed(2) : '-'}
                    </span>
                  </span>
                )}
                <span className="text-gray-400 w-24 text-right shrink-0">
                  {new Date(g.gameDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
