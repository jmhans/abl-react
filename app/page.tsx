import Link from 'next/link';

// Homepage
export default function Home() {
  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Actuarial Baseball League
        </h1>
        <p className="text-xl text-gray-600 mb-12">
          Fantasy baseball with a mathematical twist
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          <Link
            href="/dashboard"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              Dashboard
            </h2>
            <p className="text-gray-600">
              Your personalized league dashboard
            </p>
          </Link>

          <Link
            href="/games"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              Games
            </h2>
            <p className="text-gray-600">
              View and manage game schedules and results
            </p>
          </Link>

          <Link
            href="/teams"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              Teams
            </h2>
            <p className="text-gray-600">
              Browse team rosters and statistics
            </p>
          </Link>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mt-6">
          <Link
            href="/standings"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              Standings
            </h2>
            <p className="text-gray-600">
              Check current league standings
            </p>
          </Link>

          <Link
            href="/api/players"
            className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
          >
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              Players
            </h2>
            <p className="text-gray-600">
              Browse all {3300} players (API)
            </p>
          </Link>
        </div>

        <div className="mt-12 p-6 bg-blue-50 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            🚧 React Migration In Progress
          </h3>
          <p className="text-gray-700">
            This is the new React version of the ABL app. Basic APIs (Teams, Owners, Players) have been migrated to Next.js.
            More complex features (Games, Rosters, Standings) are coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}

