'use client';

import type { Team, GameSummary } from './BracketSeries';

export interface TiebreakGroupView {
  groupId: string;
  lineageId: string;
  round: number;
  seedTargets: number[];
  teams: (Team | null)[];
  games: GameSummary[];
  ablDate: string;
  status: string;
  resolvedOrder: (Team | null)[] | null;
}

function teamName(team: Team | null): string {
  if (!team) return 'TBD';
  return [team.location, team.nickname].filter(Boolean).join(' ');
}

export default function TiebreakPanel({ tiebreaks }: { tiebreaks: TiebreakGroupView[] }) {
  if (tiebreaks.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-gray-800">Seeding Tiebreakers</h2>
      {tiebreaks.map((group) => (
        <div key={group.groupId} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Seed {group.seedTargets.length > 1 ? `${group.seedTargets[0]}-${group.seedTargets[group.seedTargets.length - 1]}` : group.seedTargets[0]}
              {group.round > 1 && <span className="ml-2 text-xs text-gray-400">(round {group.round})</span>}
            </span>
            <span className="text-xs text-gray-500">
              {group.status === 'complete' ? 'Resolved' : group.status === 'unresolved_advance_to_next_round' ? 'Still tied — replay scheduled' : `Neutral site — ${group.ablDate}`}
            </span>
          </div>
          <div className="text-sm text-gray-600">
            {group.teams.map((t) => teamName(t)).join(' vs. ')}
          </div>
          {group.status === 'complete' && group.resolvedOrder && (
            <div className="mt-2 text-sm text-green-700">
              Order: {group.resolvedOrder.map((t) => teamName(t)).join(' > ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
