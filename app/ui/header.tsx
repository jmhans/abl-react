'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toggleNav } from '@/app/ui/navigation';
import ThemeToggle from './theme-toggle';

interface User {
  name?: string;
  email?: string;
  [key: string]: any;
}

export default function Header() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data?.user || null))
      .catch(() => setUser(null));
  }, []);

  return (
    <header className="bg-primary-600 text-white px-4 py-3 shadow-md sticky top-0 z-20">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleNav}
            className="text-white/80 hover:text-white p-1.5 rounded transition text-xl leading-none"
            aria-label="Open menu"
          >
            ☰
          </button>
          <Link href="/" className="text-xl font-bold tracking-tight">
            ABL
          </Link>
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-primary-100 hidden sm:inline">{user.name}</span>
              <a href="/api/auth/logout" className="text-xs bg-primary-700 hover:bg-primary-800 px-3 py-1.5 rounded transition">
                Sign out
              </a>
            </div>
          ) : (
            <a href="/api/auth/login" className="text-xs bg-primary-700 hover:bg-primary-800 px-3 py-1.5 rounded transition">
              Sign in
            </a>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
