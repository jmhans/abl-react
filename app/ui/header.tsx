'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toggleNav } from '@/app/ui/navigation';

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
          <Link href="/" className="text-2xl font-bold tracking-tight text-white hover:text-blue-50 transition">
            ABL
          </Link>
        </div>
        <div>
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-blue-50 hidden sm:inline">{user.name}</span>
              <a href="/api/auth/logout" className="text-sm bg-white text-blue-600 hover:bg-blue-50 font-bold px-3 py-2 rounded transition">
                Sign out
              </a>
            </div>
          ) : (
            <a href="/api/auth/login" className="text-sm bg-white text-blue-600 hover:bg-blue-50 font-bold px-3 py-2 rounded transition">
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
