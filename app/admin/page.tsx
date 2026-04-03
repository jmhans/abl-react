'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface AdminCard {
  href: string;
  title: string;
  description: string;
  accent: string;
  iconBg: string;
  icon: string;
}

// Cards whose hrefs need league/season context forwarded
const LEAGUE_SCOPED = new Set(['/admin/new-draft', '/admin/recalculate']);

const SITE_CARDS: AdminCard[] = [
  {
    href: '/admin/stat-refresh',
    title: 'MLB Stat Download',
    description: 'Pull boxscore data into player and statline collections for a single date or a full date range.',
    accent: 'border-l-emerald-500',
    iconBg: 'bg-emerald-100',
    icon: '📥',
  },
  {
    href: '/admin/roster-sync',
    title: 'Sync Roster Statuses',
    description: "Fetch each team's 40-man roster from the MLB Stats API and update player statuses.",
    accent: 'border-l-indigo-500',
    iconBg: 'bg-indigo-100',
    icon: '🔄',
  },
  {
    href: '/admin/positions',
    title: 'Update Player Positions',
    description: 'Reset default position and eligibility for all players based on most-played position in the current regular season.',
    accent: 'border-l-teal-500',
    iconBg: 'bg-teal-100',
    icon: '📍',
  },
  {
    href: '/admin/player-sync',
    title: 'Expand Player Pool',
    description: 'Seed players + position eligibility from 40-man rosters, spring training stats, and early season ABs. Run before the draft.',
    accent: 'border-l-cyan-500',
    iconBg: 'bg-cyan-100',
    icon: '👤',
  },
  {
    href: '/admin/projections',
    title: 'Season Projections',
    description: 'Import Fangraphs projection CSVs (Steamer, ZiPS, etc.) to show projected ABL scores on the draft page.',
    accent: 'border-l-orange-500',
    iconBg: 'bg-orange-100',
    icon: '📊',
  },
  {
    href: '/admin/score-audit',
    title: 'Score Audit',
    description: 'Compare stored vs recalculated scores to find discrepancies, without saving anything.',
    accent: 'border-l-violet-500',
    iconBg: 'bg-violet-100',
    icon: '🔍',
  },
];

const LEAGUE_CARDS: AdminCard[] = [
  {
    href: '/admin/leagues',
    title: 'League Management',
    description: 'Create leagues and manage their seasons and team rosters.',
    accent: 'border-l-purple-500',
    iconBg: 'bg-purple-100',
    icon: '🏟️',
  },
  {
    href: '/admin/seasons',
    title: 'Season Management',
    description: 'Create seasons, assign teams, and track season status.',
    accent: 'border-l-orange-500',
    iconBg: 'bg-orange-100',
    icon: '📅',
  },
  {
    href: '/admin/new-draft',
    title: 'Draft Management',
    description: 'Set pick order and start a new season draft.',
    accent: 'border-l-green-500',
    iconBg: 'bg-green-100',
    icon: '🏆',
  },
  {
    href: '/admin/recalculate',
    title: 'Recalculate Games',
    description: 'Recalculate results for individual games, a selected day, or compare played positions. Optionally scope to a single league.',
    accent: 'border-l-blue-500',
    iconBg: 'bg-blue-100',
    icon: '⚙️',
  },
];

function CardGrid({ cards, leagueQuery }: { cards: AdminCard[]; leagueQuery: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {cards.map((card) => (
        <Link
          key={card.href}
          href={LEAGUE_SCOPED.has(card.href) ? `${card.href}${leagueQuery}` : card.href}
          className={`group flex items-start gap-4 rounded-xl bg-white shadow-sm border border-gray-100 border-l-4 ${card.accent} px-5 py-4 hover:shadow-md hover:border-gray-200 transition-all`}
        >
          <div className={`shrink-0 w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center text-lg`}>
            {card.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                {card.title}
              </span>
              <span className="text-gray-300 group-hover:text-blue-400 transition-colors shrink-0">→</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5 leading-snug">{card.description}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const searchParams = useSearchParams();
  const league = searchParams.get('league') ?? '';
  const season = searchParams.get('season') ?? '';
  const leagueQuery = league && season ? `?league=${league}&season=${season}` : '';

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-10">
      <div>
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Back to Home
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Admin</h1>
        <p className="text-gray-500 mt-1 text-sm">Management tools and data operations.</p>
        {league && season && (
          <p className="text-xs text-blue-600 mt-1">League context: {league.toUpperCase()} {season}</p>
        )}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Site-Level</h2>
          <p className="text-xs text-gray-400">Global operations that apply across all leagues.</p>
        </div>
        <CardGrid cards={SITE_CARDS} leagueQuery={leagueQuery} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">League-Level</h2>
          <p className="text-xs text-gray-400">
            Operations scoped to a specific league and season.
            {!leagueQuery && <span className="text-amber-500 ml-1">Pass <code>?league=&season=</code> to pre-fill context.</span>}
          </p>
        </div>
        <CardGrid cards={LEAGUE_CARDS} leagueQuery={leagueQuery} />
      </section>
    </div>
  );
}
