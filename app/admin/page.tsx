import Link from 'next/link';

interface AdminCard {
  href: string;
  title: string;
  description: string;
  accent: string;
  iconBg: string;
  icon: string;
}

const cards: AdminCard[] = [
  {
    href: '/admin/new-draft',
    title: 'Draft Management',
    description: 'Set pick order and start a new season draft.',
    accent: 'border-l-green-500',
    iconBg: 'bg-green-100',
    icon: '🏆',
  },
  {
    href: '/draft',
    title: 'Draft Room',
    description: 'Open the live draft room.',
    accent: 'border-l-teal-500',
    iconBg: 'bg-teal-100',
    icon: '🎯',
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
    href: '/admin/stat-refresh',
    title: 'MLB Stat Download',
    description: 'Pull boxscore data into player and statline collections for a single date or a full date range.',
    accent: 'border-l-emerald-500',
    iconBg: 'bg-emerald-100',
    icon: '📥',
  },
  {
    href: '/admin/score-audit',
    title: 'Score Audit',
    description: 'Compare stored vs recalculated scores to find discrepancies, without saving anything.',
    accent: 'border-l-violet-500',
    iconBg: 'bg-violet-100',
    icon: '🔍',
  },
  {
    href: '/admin/recalculate',
    title: 'Recalculate Games',
    description: 'Recalculate results for individual games, a selected day, or compare played positions.',
    accent: 'border-l-blue-500',
    iconBg: 'bg-blue-100',
    icon: '⚙️',
  },
];

export default function AdminPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
      <div>
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-800 inline-block mb-4">
          ← Back to Home
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Admin</h1>
        <p className="text-gray-500 mt-1 text-sm">Management tools and data operations.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`group flex items-start gap-4 rounded-xl bg-white shadow-sm border border-gray-100 border-l-4 ${card.accent} px-5 py-4 hover:shadow-md hover:border-gray-200 transition-all`}
          >
            <div
              className={`shrink-0 w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center text-lg`}
            >
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
    </div>
  );
}
