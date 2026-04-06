'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type AdminCoOwnerUser = {
  userId: string;
  name: string;
  selectable: boolean;
  rawName?: string;
  email?: string;
};

export default function AdminCoOwnerUsersPage() {
  const [users, setUsers] = useState<AdminCoOwnerUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/admin/co-owner-users', { cache: 'no-store' });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load users');
      }
      const nextUsers = Array.isArray(data) ? data : [];
      setUsers(nextUsers);
      setEditingNames(
        Object.fromEntries(nextUsers.map((user) => [user.userId, user.name]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      u.name.toLowerCase().includes(q)
      || u.userId.toLowerCase().includes(q)
      || (u.rawName || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const selectableCount = users.filter((u) => u.selectable).length;
  const deselectedCount = users.length - selectableCount;

  const handleToggle = async (userId: string, selectable: boolean) => {
    try {
      setSavingIds((prev) => ({ ...prev, [userId]: true }));
      setError('');
      setSuccess('');

      const res = await fetch('/api/admin/co-owner-users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, selectable }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update user selection');
      }

      setUsers((prev) =>
        prev.map((u) => (u.userId === userId ? { ...u, selectable } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user selection');
    } finally {
      setSavingIds((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleSaveDisplayName = async (userId: string) => {
    const displayName = (editingNames[userId] || '').trim();
    if (displayName.length < 2 || displayName.length > 40) {
      setError('Display name must be between 2 and 40 characters.');
      setSuccess('');
      return;
    }

    try {
      setSavingIds((prev) => ({ ...prev, [userId]: true }));
      setError('');
      setSuccess('');

      const res = await fetch('/api/admin/co-owner-users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, displayName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update display name');
      }

      const savedName = data?.displayName || displayName;
      setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, name: savedName } : u)));
      setEditingNames((prev) => ({ ...prev, [userId]: savedName }));
      setSuccess('Display name updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update display name');
      setSuccess('');
    } finally {
      setSavingIds((prev) => ({ ...prev, [userId]: false }));
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-primary-600 hover:text-primary-700 inline-block mb-4">
          ← Back to Admin
        </Link>
        <h1 className="text-3xl font-bold text-text-primary">Co-owner User Access</h1>
        <p className="text-text-secondary mt-1 text-sm">
          Select which users are available in the Add Co-owner workflow.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-widest text-gray-400">Total Users</p>
          <p className="text-2xl font-bold text-gray-900">{users.length}</p>
        </div>
        <div className="bg-white border border-green-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-widest text-green-600">Selectable</p>
          <p className="text-2xl font-bold text-green-700">{selectableCount}</p>
        </div>
        <div className="bg-white border border-amber-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-widest text-amber-600">Deselected</p>
          <p className="text-2xl font-bold text-amber-700">{deselectedCount}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by display name, Auth0 name, email, or user ID..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 text-green-700 px-4 py-3 text-sm">
          {success}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Loading users...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No users found.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredUsers.map((user) => (
              <div key={user.userId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                  {(user.rawName || user.email) && (
                    <p className="text-xs text-gray-600 truncate">
                      {[user.rawName, user.email].filter(Boolean).join(' • ')}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 truncate">{user.userId}</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      maxLength={40}
                      value={editingNames[user.userId] || ''}
                      onChange={(e) =>
                        setEditingNames((prev) => ({ ...prev, [user.userId]: e.target.value }))
                      }
                      className="w-full sm:max-w-xs border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="App display name"
                    />
                    <button
                      disabled={Boolean(savingIds[user.userId]) || (editingNames[user.userId] || '').trim() === user.name}
                      onClick={() => handleSaveDisplayName(user.userId)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save Name
                    </button>
                  </div>
                </div>

                <button
                  disabled={Boolean(savingIds[user.userId])}
                  onClick={() => handleToggle(user.userId, !user.selectable)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
                    user.selectable
                      ? 'bg-green-100 text-green-800 hover:bg-green-200'
                      : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                  }`}
                >
                  {savingIds[user.userId]
                    ? 'Saving...'
                    : user.selectable
                      ? 'Selectable'
                      : 'Deselected'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
