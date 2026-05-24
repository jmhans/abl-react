'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toggleNav } from '@/app/ui/navigation';

interface User {
  name?: string;
  email?: string;
  [key: string]: unknown;
}

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  const match = pathname?.match(/^\/([^/]+)\/(\d{4})(\/.*)?$/);
  const pathLeague = pathname?.match(/^\/([^/]+)/)?.[1]?.toLowerCase();
  const currentLeague = pathLeague === 'abml' ? 'abml' : 'abl';
  const currentSeason = match?.[2] || '2026';
  const currentSuffix = match?.[3] || '';

  const onLeagueChange = (league: 'abl' | 'abml') => {
    const target = match
      ? `/${league}/${currentSeason}${currentSuffix}`
      : `/${league}/${currentSeason}`;
    router.push(target);
  };

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data?.user || null))
      .catch(() => setUser(null));
  }, []);

  return (
    <header className="bg-blue-600 text-white px-4 py-3 shadow-md sticky top-0 z-20">
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
            <label className="sr-only" htmlFor="league-context-select">Select league: ABL or ABML</label>
            <select
              id="league-context-select"
              value={currentLeague === 'abml' ? 'abml' : 'abl'}
              onChange={(e) => onLeagueChange(e.target.value as 'abl' | 'abml')}
              className="text-sm md:text-base font-semibold tracking-tight rounded bg-white/15 border border-white/40 px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-white/70"
            >
              <option value="abl" className="text-gray-900">ABL</option>
              <option value="abml" className="text-gray-900">ABML</option>
            </select>
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
