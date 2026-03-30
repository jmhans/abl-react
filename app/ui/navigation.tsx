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

interface SessionUser {
  sub: string;
  name: string;
  email?: string;
  picture?: string;
}

interface MyLeagueEntry {
  team: { _id: string; nickname: string; location: string } | null;
  season: { _id: string; year: number; slug: string };
  league: { _id: string; name: string; slug: string } | null;
}

export default function Navigation() {
  const base = useLeagueSeasonBase();
  const currentLeagueSlug = base.split('/')[1] ?? '';
  const currentSeasonYear = base.split('/')[2] ?? '';

  const [user, setUser] = useState<SessionUser | null>(null);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [myLeagues, setMyLeagues] = useState<MyLeagueEntry[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [meRes, adminRes, myLeaguesRes] = await Promise.all([
          fetch('/api/auth/me').then((r) => r.json()).catch(() => ({ user: null })),
          fetch('/api/admin/me').then((r) => r.json()).catch(() => ({})),
          fetch('/api/auth/my-leagues').then((r) => r.json()).catch(() => []),
        ]);

        if (adminRes?.isAdmin) setIsAdmin(true);

        const sessionUser = meRes?.user ?? null;
        setUser(sessionUser);
        setMyLeagues(Array.isArray(myLeaguesRes) ? myLeaguesRes : []);

        if (sessionUser?.sub) {
          // Find the team in the current league/season
          const currentEntry = (Array.isArray(myLeaguesRes) ? myLeaguesRes : []).find(
            (e: MyLeagueEntry) =>
              e.league?.slug === currentLeagueSlug &&
              String(e.season?.year) === currentSeasonYear
          );
          if (currentEntry?.team) {
            setUserTeamId(currentEntry.team._id);
          } else {
            // Fallback: search all teams
            const teamsRes = await fetch('/api/teams').then((r) => r.json()).catch(() => []);
            const myTeam = (Array.isArray(teamsRes) ? teamsRes : []).find((t: any) =>
              t.owners?.some((o: any) => o.userId === sessionUser.sub)
            );
            if (myTeam) setUserTeamId(myTeam._id);
          }
        }
      } catch (err) {
        console.error('Nav load error:', err);
      }
    };
    load();
  }, [currentLeagueSlug, currentSeasonYear]);

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <aside
      className={`${isOpen ? 'w-64' : 'w-16'} bg-gray-100 border-r border-gray-200 min-h-screen transition-all duration-200 ease-in-out flex flex-col`}
    >
      {/* Hamburger */}
      <div className="p-4 border-b border-gray-200">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-gray-600 hover:text-gray-900 text-xl p-2 hover:bg-gray-200 rounded transition"
          title={isOpen ? 'Collapse' : 'Expand'}
        >
          ☰
        </button>
      </div>

      {/* League switcher */}
      {isOpen && myLeagues.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
            League
          </p>
          {myLeagues.length === 1 ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">
                {myLeagues[0].league?.name ?? currentLeagueSlug.toUpperCase()}
              </span>
              <span className="text-xs text-gray-400">{myLeagues[0].season?.year}</span>
            </div>
          ) : (
            <div className="space-y-1">
              {myLeagues.map((entry) => {
                if (!entry.league) return null;
                const href = `/${entry.league.slug}/${entry.season.year}`;
                const isCurrent =
                  entry.league.slug === currentLeagueSlug &&
                  String(entry.season.year) === currentSeasonYear;
                return (
                  <Link
                    key={entry.season._id}
                    href={href}
                    className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      isCurrent
                        ? 'bg-blue-100 text-blue-700 font-semibold'
                        : 'text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <span>{entry.league.name}</span>
                    <span className="text-xs opacity-60">{entry.season.year}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Nav links */}
      <nav className="space-y-2 p-4 flex-1">
        <Link
          href={base}
          className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm"
          title="Dashboard"
        >
          {isOpen ? 'Dashboard' : '📊'}
        </Link>
        <Link
          href={`${base}/standings`}
          className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm"
          title="Standings"
        >
          {isOpen ? 'Standings' : '📈'}
        </Link>
        <Link
          href={`${base}/draft`}
          className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm"
          title="Draft"
        >
          {isOpen ? 'Draft' : '🎯'}
        </Link>
        {userTeamId ? (
          <>
            <Link
              href={`${base}/teams/${userTeamId}/roster`}
              className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm"
              title="My Roster"
            >
              {isOpen ? 'My Roster' : '👥'}
            </Link>
            <Link
              href={`${base}/teams/${userTeamId}/free-agents`}
              className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm"
              title="Free Agents"
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
          className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm"
          title="Scores"
        >
          {isOpen ? 'Scores' : '⚾'}
        </Link>
        {isAdmin && (
          <Link
            href="/admin"
            className="block px-4 py-2 rounded hover:bg-gray-200 transition text-sm"
            title="Admin"
          >
            {isOpen ? 'Admin' : '⚙️'}
          </Link>
        )}
      </nav>

      {/* Profile section */}
      <div className="border-t border-gray-200 p-4">
        {user ? (
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
              {user.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full object-cover" />
              ) : (
                initials
              )}
            </div>
            {isOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{user.name}</p>
                <a
                  href="/api/auth/logout"
                  className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                >
                  Sign out
                </a>
              </div>
            )}
          </div>
        ) : (
          <a
            href="/api/auth/login"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors ${isOpen ? '' : 'justify-center'}`}
            title="Sign In"
          >
            <span>🔑</span>
            {isOpen && <span>Sign In</span>}
          </a>
        )}
      </div>
    </aside>
  );
}
