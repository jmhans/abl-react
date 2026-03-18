'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function Header() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Check for user session by making a request to a session endpoint  
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data?.user || null))
      .catch(() => setUser(null));
  }, []);

  return (
    <header className="bg-blue-600 text-white p-4 shadow-md">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <Link href="/" className="text-2xl font-bold">
          ABL
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="/standings" className="hover:text-blue-100">
            Standings
          </Link>
          <Link href="/rosters" className="hover:text-blue-100">
            Rosters
          </Link>
          <Link href="/free-agents" className="hover:text-blue-100">
            Free Agents
          </Link>
          <div className="border-l border-blue-400 pl-4">
            {user ? (
              <div className="flex items-center gap-4">
                <span>{user.name}</span>
                <a href="/api/auth/logout" className="bg-blue-800 px-3 py-1 rounded hover:bg-blue-900">
                  Logout
                </a>
              </div>
            ) : (
              <a href="/api/auth/login" className="bg-blue-800 px-3 py-1 rounded hover:bg-blue-900">
                Login
              </a>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
