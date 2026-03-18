'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface User {
  name?: string;
  email?: string;
  picture?: string;
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setUser(data?.user || null);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Link href="/" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to Home
        </Link>
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Dashboard</h1>
        {user && (
          <p className="text-gray-600">
            Welcome back, {user.name || user.email}!
          </p>
        )}
        {!user && (
          <p className="text-gray-600">
            <a href="/api/auth/login" className="text-blue-600 hover:text-blue-800">
              Log in
            </a> to access your personalized dashboard
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/teams" className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow">
          <h2 className="text-lg font-semibold mb-2">Teams</h2>
          <p className="text-gray-600">Browse all league teams</p>
        </Link>

        <Link href="/games" className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow">
          <h2 className="text-lg font-semibold mb-2">Games</h2>
          <p className="text-gray-600">View game schedules and results</p>
        </Link>
        
        <div className="bg-gray-100 p-6 rounded-lg shadow cursor-not-allowed">
          <h2 className="text-lg font-semibold mb-2 text-gray-500">Standings</h2>
          <p className="text-gray-500">Coming soon - League standings</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <div className="bg-gray-100 p-6 rounded-lg shadow cursor-not-allowed">
          <h2 className="text-lg font-semibold mb-2 text-gray-500">My Roster</h2>
          <p className="text-gray-500">Coming soon - Manage your team roster</p>
        </div>
        
        <div className="bg-gray-100 p-6 rounded-lg shadow cursor-not-allowed">
          <h2 className="text-lg font-semibold mb-2 text-gray-500">Free Agents</h2>
          <p className="text-gray-500">Coming soon - Pick up available players</p>
        </div>
      </div>
    </div>
  );
}
