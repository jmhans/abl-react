'use client';

import Link from 'next/link';

export default function Navigation() {
  return (
    <aside className="w-64 bg-gray-100 p-4 border-r border-gray-200 min-h-screen">
      <nav className="space-y-2">
        <Link 
          href="/dashboard" 
          className="block px-4 py-2 rounded hover:bg-gray-200 transition"
        >
          Dashboard
        </Link>
        <Link 
          href="/standings" 
          className="block px-4 py-2 rounded hover:bg-gray-200 transition"
        >
          Standings
        </Link>
        <Link 
          href="/rosters" 
          className="block px-4 py-2 rounded hover:bg-gray-200 transition"
        >
          My Roster
        </Link>
        <Link 
          href="/free-agents" 
          className="block px-4 py-2 rounded hover:bg-gray-200 transition"
        >
          Free Agents
        </Link>
        <Link 
          href="/scores" 
          className="block px-4 py-2 rounded hover:bg-gray-200 transition"
        >
          Scores
        </Link>
      </nav>
    </aside>
  );
}
