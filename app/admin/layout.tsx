'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'authorized' | 'unauthorized'>('loading');

  useEffect(() => {
    fetch('/api/admin/me')
      .then((r) => r.json())
      .catch(() => ({}))
      .then((data) => setState(data?.isAdmin ? 'authorized' : 'unauthorized'));
  }, []);

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  if (state === 'unauthorized') {
    return (
      <div className="container mx-auto px-4 py-8 space-y-4 max-w-2xl">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm inline-block">
          ← Back to Home
        </Link>
        <div className="bg-white rounded-xl shadow p-8 text-center space-y-3">
          <h1 className="text-2xl font-bold text-gray-900">Admin Only</h1>
          <p className="text-gray-500">You need an admin account to access this area.</p>
          <a
            href="/api/auth/login"
            className="inline-block mt-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
