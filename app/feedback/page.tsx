'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Issue {
  number: number;
  title: string;
  body: string | null;
  createdAt: string;
  url: string;
}

export default function FeedbackPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [issuesError, setIssuesError] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [user, setUser] = useState<{ name: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(data => setUser(data?.user ?? null))
      .catch(() => {});
  }, []);

  const fetchIssues = async () => {
    setLoadingIssues(true);
    setIssuesError('');
    try {
      const res = await fetch('/api/feedback');
      if (!res.ok) throw new Error('Failed to load feedback');
      setIssues(await res.json());
    } catch {
      setIssuesError('Could not load reported issues.');
    } finally {
      setLoadingIssues(false);
    }
  };

  useEffect(() => {
    fetchIssues();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    setSubmitSuccess('');

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'Failed to submit feedback');
        return;
      }
      setSubmitSuccess(`Thanks! Issue #${data.number} has been logged.`);
      setTitle('');
      setDescription('');
      fetchIssues();
    } catch {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = title.trim().length >= 5 && !submitting;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Feedback &amp; Bug Reports</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Found a bug or have a suggestion? Log it here and it'll appear in the list below.
        </p>
      </div>

      {/* Submit form */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4">Submit Feedback</h2>

        {!user ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            <a href="/api/auth/login" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">Sign in</a>{' '}
            to submit feedback.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="fb-title" className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="fb-title"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={200}
                placeholder="Short description of the issue or idea"
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <p className="mt-1 text-xs text-gray-400">{title.length}/200</p>
            </div>
            <div>
              <label htmlFor="fb-desc" className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                Details <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="fb-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                maxLength={5000}
                rows={4}
                placeholder="Steps to reproduce, expected behavior, etc."
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
              />
            </div>

            {submitError && (
              <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
            )}
            {submitSuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">{submitSuccess}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        )}
      </div>

      {/* Issue list */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">
          Open Reports
          {!loadingIssues && !issuesError && (
            <span className="ml-2 text-xs font-normal text-gray-400">({issues.length})</span>
          )}
        </h2>

        {loadingIssues ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : issuesError ? (
          <p className="text-sm text-red-500">{issuesError}</p>
        ) : issues.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No open reports yet. Be the first!</p>
        ) : (
          <ul className="space-y-2">
            {issues.map(issue => (
              <li
                key={issue.number}
                className="flex items-start justify-between gap-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{issue.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    #{issue.number} &middot; {new Date(issue.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 whitespace-nowrap"
                >
                  View →
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Issues are tracked on{' '}
        <a
          href={`https://github.com/jmhans/abl-react/issues`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
