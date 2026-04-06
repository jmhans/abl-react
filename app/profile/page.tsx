'use client';

import { useEffect, useState } from 'react';

export default function ProfilePage() {
  const [displayName, setDisplayName] = useState('');
  const [initialName, setInitialName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await fetch('/api/profile', { cache: 'no-store' });
        if (!res.ok) {
          throw new Error('Failed to load profile');
        }
        const data = await res.json();
        const name = data?.displayName || '';
        setDisplayName(name);
        setInitialName(name);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const canSave = displayName.trim().length >= 2 && displayName.trim().length <= 40;

  const handleSave = async () => {
    if (!canSave || saving) return;

    try {
      setSaving(true);
      setError('');
      setSuccess('');

      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save display name');
      }

      const savedName = data?.displayName || displayName.trim();
      setDisplayName(savedName);
      setInitialName(savedName);
      setSuccess('Display name updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save display name');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Profile</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
          Choose the display name shown to other users across ABL.
        </p>

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading profile…</p>
        ) : (
          <>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2" htmlFor="display-name">
              Display Name
            </label>
            <input
              id="display-name"
              type="text"
              maxLength={40}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Your display name"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {displayName.trim().length}/40 characters
            </p>

            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
            {success && <p className="text-sm text-green-600 dark:text-green-400 mb-3">{success}</p>}

            <button
              onClick={handleSave}
              disabled={saving || !canSave || displayName.trim() === initialName}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save Display Name'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
