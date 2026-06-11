'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toggleNav } from '@/app/ui/navigation';

interface User {
  name?: string;
  email?: string;
  [key: string]: unknown;
}

interface MyLeagueEntry {
  season?: {
    year?: number;
    status?: string;
  };
  league?: {
    slug?: string;
  } | null;
}

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [myLeagues, setMyLeagues] = useState<MyLeagueEntry[]>([]);
  const headerRef = useRef<HTMLElement>(null);

  // Expose the rendered header height as a CSS variable so other sticky
  // elements (e.g. the roster table header) can stick just below it.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const setHeightVar = () => {
      document.documentElement.style.setProperty('--app-header-height', `${el.offsetHeight}px`);
    };
    setHeightVar();
    const observer = new ResizeObserver(setHeightVar);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pathMatch = pathname?.match(/^\/([^/]+)(?:\/(\d{4})(\/.*)?)?$/);
  const pathLeague = pathMatch?.[1]?.toLowerCase();
  const currentLeague = pathLeague === 'abml' ? 'abml' : 'abl';
  const currentSeason = pathMatch?.[2] || '2026';
  const activeLeagueMap = myLeagues.reduce((map, entry) => {
    const slug = entry.league?.slug?.toLowerCase();
    if (!slug || entry.season?.status === 'completed') return map;
    if (slug !== 'abl' && slug !== 'abml') return map;
    if (!map.has(slug)) {
      map.set(slug, {
        slug,
        season: entry.season?.year ? String(entry.season.year) : currentSeason,
      });
    }
    return map;
  }, new Map<'abl' | 'abml', { slug: 'abl' | 'abml'; season: string }>());
  const activeLeagueOptions = Array.from(activeLeagueMap.values()).sort((a, b) => a.slug.localeCompare(b.slug));
  const canSwitchLeagues = activeLeagueMap.size > 1;
  const lockedLeague = activeLeagueMap.size === 1
    ? activeLeagueOptions[0]
    : null;
  const displayLeague = activeLeagueMap.get(currentLeague) || lockedLeague || {
    slug: currentLeague,
    season: currentSeason,
  };

  const onLeagueChange = (league: 'abl' | 'abml') => {
    const targetLeague = activeLeagueMap.get(league);
    if (!targetLeague) return;
    router.push(`/${targetLeague.slug}/${targetLeague.season}`);
  };

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me')
        .then(res => res.ok ? res.json() : null)
        .catch((error) => {
          console.error('Failed to load session user in header:', error);
          return null;
        }),
      fetch('/api/auth/my-leagues')
        .then(res => res.ok ? res.json() : [])
        .catch((error) => {
          console.error('Failed to load league memberships in header:', error);
          return [];
        }),
    ])
      .then(([meData, leaguesData]) => {
        setUser(meData?.user || null);
        setMyLeagues(Array.isArray(leaguesData) ? leaguesData : []);
      })
      .catch(() => {
        setUser(null);
        setMyLeagues([]);
      });
  }, []);

  return (
    <header ref={headerRef} className="bg-blue-600 text-white px-4 py-3 shadow-md sticky top-0 z-20">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleNav}
            className="text-white hover:text-blue-50 p-1.5 rounded transition text-xl leading-none font-bold"
            aria-label="Open menu"
          >
            ☰
          </button>
          <div>
            {canSwitchLeagues ? (
              <>
                <label className="sr-only" htmlFor="league-context-select">Select league: ABL or ABML</label>
                <select
                  id="league-context-select"
                  value={displayLeague.slug}
                  onChange={(e) => onLeagueChange(e.target.value as 'abl' | 'abml')}
                  className="text-sm md:text-base font-semibold tracking-tight rounded bg-white/15 border border-white/40 px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-white/70"
                >
                  {activeLeagueOptions.map((option) => (
                    <option key={option.slug} value={option.slug} className="text-gray-900">
                      {option.slug.toUpperCase()}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <div className="text-sm md:text-base font-semibold tracking-tight rounded bg-white/15 border border-white/20 px-2 py-1 text-white">
                {displayLeague.slug.toUpperCase()}
              </div>
            )}
          </div>
        </div>
        <div>
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-blue-50 hidden sm:inline">{user.name}</span>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/auth/logout" className="text-sm bg-white text-blue-600 hover:bg-blue-50 font-bold px-3 py-2 rounded transition">
                Sign out
              </a>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/api/auth/login" className="text-sm bg-white text-blue-600 hover:bg-blue-50 font-bold px-3 py-2 rounded transition">
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
