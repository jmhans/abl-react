'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

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
    <header className="bg-blue-600 text-white px-4 py-3 shadow-md">
      <div className="flex justify-between items-center">
        <Link href="/" className="text-xl font-bold tracking-tight">
          ABL
        </Link>
        <div>
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-blue-100">{user.name}</span>
              <a href="/api/auth/logout" className="text-xs bg-blue-800 hover:bg-blue-900 px-3 py-1.5 rounded transition">
                Sign out
              </a>
            </div>
          ) : (
            <a href="/api/auth/login" className="text-xs bg-blue-800 hover:bg-blue-900 px-3 py-1.5 rounded transition">
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
