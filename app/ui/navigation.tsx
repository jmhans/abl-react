'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/** Extract /[league]/[season] prefix from the current URL, fallback to /abl/2025 */
function useLeagueSeasonBase(defaultBase = '/abl/2025'): string {
  const pathname = usePathname();
  const match = pathname?.match(/^\/([^/]+)\/(\d{4})(\/|$)/);
  if (match) return `/${match[1]}/${match[2]}`;
  return defaultBase;
}

export default function Navigation() {
  const base = useLeagueSeasonBase();
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const fetchUserTeam = async () => {
      try {
        const [userRes, adminRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/admin/me'),
        ]);

        if (adminRes.ok) {
          const adminData = await adminRes.json();
          setIsAdmin(Boolean(adminData?.isAdmin));
        }

        if (userRes.ok) {
          const userData = await userRes.json();
          const user = userData?.user;

          if (!user?.sub) return;

          const teamsRes = await fetch('/api/teams');
          if (teamsRes.ok) {
            const teams = await teamsRes.json();
            const myTeam = teams.find((t: any) =>
              t.owners?.some((o: any) => o.userId === user.sub)
            );
            if (myTeam) {
              setUserTeamId(myTeam._id);
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch user team:', err);
      }
    };

    fetchUserTeam();
  }, []);

  return (
    <aside className={`${isOpen ? 'w-64' : 'w-16'} bg-gray-100 border-r border-gray-200 min-h-screen transition-all duration-200 ease-in-out flex flex-col`}>
      <div className="p-4 border-b border-gray-200">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-gray-600 hover:text-gray-900 text-xl p-2 hover:bg-gray-200 rounded transition"
          title={isOpen ? 'Collapse' : 'Expand'}
        >
          ☰
        </button>
      </div>
      <nav className="space-y-2 p-4 flex-1">
        <Link
          href={base}
          className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm" title="Dashboard"
        >
          {isOpen ? 'Dashboard' : '📊'}
        </Link>
        <Link
          href={`${base}/standings`}
          className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm" title="Standings"
        >
          {isOpen ? 'Standings' : '📈'}
        </Link>
        <Link
          href={`${base}/draft`}
          className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm" title="Draft"
        >
          {isOpen ? 'Draft' : '🎯'}
        </Link>
        {userTeamId ? (
          <>
            <Link
              href={`${base}/teams/${userTeamId}/roster`}
              className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm" title="My Roster"
            >
              {isOpen ? 'My Roster' : '👥'}
            </Link>
            <Link
              href={`${base}/teams/${userTeamId}/free-agents`}
              className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm" title="Free Agents"
            >
              {isOpen ? 'Free Agents' : '✨'}
            </Link>
          </>
        ) : (
          <>
            <div className="block px-4 py-2 rounded text-gray-400 cursor-not-allowed text-sm">
              {isOpen ? 'My Roster' : '👥'}
            </div>
            <div className="block px-4 py-2 rounded text-gray-400 cursor-not-allowed text-sm">
              {isOpen ? 'Free Agents' : '✨'}
            </div>
          </>
        )}
        <Link
          href={`${base}/games`}
          className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm" title="Scores"
        >
          {isOpen ? 'Scores' : '⚾'}
        </Link>
        {isAdmin && (
          <Link 
            href="/admin" 
            className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm" title="Admin"
          >
            {isOpen ? 'Admin' : '⚙️'}
          </Link>
        )}
      </nav>
    </aside>
  );
}
