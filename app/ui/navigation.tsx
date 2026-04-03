'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/** Extract /[league]/[season] prefix from the current URL, fallback to /abl/2026 */
function useLeagueSeasonBase(defaultBase = '/abl/2026'): string {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const match = pathname?.match(/^\/([^/]+)\/(\d{4})(\/|$)/);
  if (match) return `/${match[1]}/${match[2]}`;
  const qLeague = searchParams.get('league');
  const qSeason = searchParams.get('season');
  if (qLeague && qSeason && /^\d{4}$/.test(qSeason)) return `/${qLeague}/${qSeason}`;
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
  season: { _id: string; year: number; slug: string; status?: string };
  league: { _id: string; name: string; slug: string } | null;
}

interface AvailableLeagueEntry {
  league: { _id: string; name: string; slug: string };
  season: { _id: string; year: number };
}

/** Call this from the Header to toggle the drawer. We use a custom event so
 *  the two components don't need to share state via a context. */
export function toggleNav() {
  window.dispatchEvent(new Event('abl:toggle-nav'));
}

export default function Navigation() {
  const pathname = usePathname();
  const base = useLeagueSeasonBase();
  const currentLeagueSlug = base.split('/')[1] ?? '';
  const currentSeasonYear = base.split('/')[2] ?? '';

  const [user, setUser] = useState<SessionUser | null>(null);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [myLeagues, setMyLeagues] = useState<MyLeagueEntry[]>([]);
  const [availableLeagues, setAvailableLeagues] = useState<AvailableLeagueEntry[]>([]);
  const [hasDraft, setHasDraft] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Listen for toggle events fired by the Header hamburger
  useEffect(() => {
    const handler = () => setIsOpen((v) => !v);
    window.addEventListener('abl:toggle-nav', handler);
    return () => window.removeEventListener('abl:toggle-nav', handler);
  }, []);

  // Close on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close when clicking outside the drawer
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const isActive = (href: string, exact = false) =>
    pathname === href || (!exact && (pathname?.startsWith(href + '/') ?? false));

  const navLinkClass = (href: string, exact = false) =>
    `block px-4 py-2.5 rounded-lg transition text-sm ${
      isActive(href, exact)
        ? 'bg-blue-100 text-blue-700 font-semibold'
        : 'text-gray-700 hover:bg-gray-100'
    }`;

  useEffect(() => {
    const load = async () => {
      try {
        const [meRes, adminRes, myLeaguesRes, availableRes] = await Promise.all([
          fetch('/api/auth/me').then((r) => r.json()).catch(() => ({ user: null })),
          fetch('/api/admin/me').then((r) => r.json()).catch(() => ({})),
          fetch('/api/auth/my-leagues').then((r) => r.json()).catch(() => []),
          fetch('/api/auth/available-leagues').then((r) => r.json()).catch(() => []),
        ]);

        if (adminRes?.isAdmin) setIsAdmin(true);

        const sessionUser = meRes?.user ?? null;
        setUser(sessionUser);
        setMyLeagues(Array.isArray(myLeaguesRes) ? myLeaguesRes : []);
        setAvailableLeagues(Array.isArray(availableRes) ? availableRes : []);

        if (sessionUser?.sub) {
          const currentEntry = (Array.isArray(myLeaguesRes) ? myLeaguesRes : []).find(
            (e: MyLeagueEntry) =>
              e.league?.slug === currentLeagueSlug &&
              String(e.season?.year) === currentSeasonYear
          );
          if (currentEntry?.team) {
            setUserTeamId(currentEntry.team._id);
          } else {
            const teamsRes = await fetch('/api/teams').then((r) => r.json()).catch(() => []);
            const myTeam = (Array.isArray(teamsRes) ? teamsRes : []).find((t: any) =>
              t.owners?.some((o: any) => o.userId === sessionUser.sub)
            );
            if (myTeam) setUserTeamId(myTeam._id);
          }
        }

        if (sessionUser && currentLeagueSlug && currentSeasonYear) {
          try {
            const draftCheck = await fetch(
              `/api/games?league=${currentLeagueSlug}&season=${currentSeasonYear}&gameType=D&limit=1&view=summary`
            ).then((r) => r.json()).catch(() => []);
            setHasDraft(Array.isArray(draftCheck) && draftCheck.length > 0);
          } catch {
            setHasDraft(false);
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
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm"
          aria-hidden="true"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Drawer */}
      <aside
        ref={drawerRef}
        className={`fixed top-0 left-0 z-40 h-full w-72 bg-white border-r border-gray-200 shadow-xl flex flex-col
          transition-transform duration-200 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-blue-600">
          <Link href="/" className="text-white font-bold text-lg tracking-tight" onClick={() => setIsOpen(false)}>
            ABL
          </Link>
          <button
            onClick={() => setIsOpen(false)}
            className="text-white/80 hover:text-white p-1 rounded transition"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {/* League switcher */}
        {myLeagues.length > 0 && (() => {
          const activeLeagues = myLeagues.filter(e => e.season?.status !== 'completed');
          const hasCompleted = myLeagues.some(e => e.season?.status === 'completed');
          return (
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1.5">League</p>
              {activeLeagues.length === 1 ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{activeLeagues[0].league?.name ?? currentLeagueSlug.toUpperCase()}</span>
                  <span className="text-xs text-gray-400">{activeLeagues[0].season?.year}</span>
                </div>
              ) : activeLeagues.length > 1 ? (
                <div className="space-y-1">
                  {activeLeagues.map((entry) => {
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
                          isCurrent ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <span>{entry.league.name}</span>
                        <span className="text-xs opacity-60">{entry.season.year}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
              {hasCompleted && (
                <Link href="/my-seasons" className="mt-2 block text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  View completed seasons →
                </Link>
              )}
            </div>
          );
        })()}

        {/* Join available leagues */}
        {user && availableLeagues.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-100 space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Join a League</p>
            {availableLeagues.map((entry) => (
              <Link
                key={entry.season._id.toString()}
                href={`/join/${entry.league.slug}`}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 transition-colors font-medium"
              >
                <span>{entry.league.name} {entry.season.year}</span>
                <span className="text-xs">Join →</span>
              </Link>
            ))}
          </div>
        )}

        {/* Nav links */}
        <nav className="space-y-0.5 p-3 flex-1 overflow-y-auto">
          <Link href={base} className={navLinkClass(base, true)}>Dashboard</Link>
          <Link href={`${base}/standings`} className={navLinkClass(`${base}/standings`)}>Standings</Link>
          <Link href={`${base}/games`} className={navLinkClass(`${base}/games`)}>Scores</Link>
          {hasDraft && (
            <Link href={`${base}/draft`} className={navLinkClass(`${base}/draft`)}>Draft</Link>
          )}
          {userTeamId ? (
            <>
              <Link href={`${base}/teams/${userTeamId}/roster`} className={navLinkClass(`${base}/teams/${userTeamId}/roster`)}>My Team</Link>
              <Link href={`${base}/teams/${userTeamId}/free-agents`} className={navLinkClass(`${base}/teams/${userTeamId}/free-agents`)}>Free Agents</Link>
            </>
          ) : (
            user && <div className="px-4 py-2 text-xs text-gray-400">No team this season</div>
          )}
          {isAdmin && (
            <Link
              href={`/admin${currentLeagueSlug && currentSeasonYear ? `?league=${currentLeagueSlug}&season=${currentSeasonYear}` : ''}`}
              className={navLinkClass('/admin')}
            >
              Admin
            </Link>
          )}
        </nav>

        {/* Profile */}
        <div className="border-t border-gray-200 p-4">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                {user.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.picture} alt={user.name} className="w-8 h-8 object-cover" />
                ) : (
                  initials
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{user.name}</p>
                <a href="/api/auth/logout" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
                  Sign out
                </a>
              </div>
            </div>
          ) : (
            <a
              href="/api/auth/login"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <span>🔑</span><span>Sign In</span>
            </a>
          )}
        </div>
      </aside>
    </>
  );
}