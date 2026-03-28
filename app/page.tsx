'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface User {
  name?: string;
  email?: string;
  picture?: string;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userRes = await fetch('/api/auth/me');
        if (!userRes.ok) {
          setLoading(false);
          return;
        }

        const userData = await userRes.json();
        const user = userData?.user;
        setUser(user || null);
      } catch (err) {
        console.error('Error fetching user:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
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
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Actuarial Baseball League</h1>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link href="/teams" className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow">
          <h2 className="text-lg font-semibold mb-2">Teams</h2>
          <p className="text-gray-600">Browse all league teams</p>
        </Link>

        <Link href="/games" className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow">
          <h2 className="text-lg font-semibold mb-2">Games</h2>
          <p className="text-gray-600">View game schedules and results</p>
        </Link>

        <Link href="/draft" className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow">
          <h2 className="text-lg font-semibold mb-2">Draft Room</h2>
          <p className="text-gray-600">Run the 24-round grouped snake draft board</p>
        </Link>
      </div>
    </div>
  );
}

