import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserFromCookies } from '@/app/lib/admin-auth';

const GITHUB_TOKEN = process.env.GITHUB_FEEDBACK_TOKEN;
const REPO_OWNER = 'jmhans';
const REPO_NAME = 'abl-react';
const FEEDBACK_LABEL = 'feedback';
const GITHUB_API = 'https://api.github.com';

// How far back to show closed issues by default (30 days)
const CLOSED_HISTORY_DAYS = 30;

// GET /api/feedback — list issues labelled 'feedback'
// Query params:
//   state = 'open' | 'closed' | 'all'  (default: 'open')
export async function GET(request: NextRequest) {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'Feedback not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const rawState = searchParams.get('state') ?? 'open';
  const state = ['open', 'closed', 'all'].includes(rawState) ? rawState : 'open';

  const params = new URLSearchParams({
    labels: FEEDBACK_LABEL,
    state,
    per_page: '50',
    sort: 'created',
    direction: 'desc',
  });

  // For closed or all, limit to the past CLOSED_HISTORY_DAYS days so the list
  // doesn't grow unbounded. The UI provides a link to GitHub for older items.
  if (state === 'closed' || state === 'all') {
    const since = new Date(Date.now() - CLOSED_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    params.set('since', since);
  }

  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/issues?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch issues' }, { status: 502 });
  }

  const issues = await res.json();

  // Return only the fields the UI needs
  const mapped = issues.map((issue: any) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state as 'open' | 'closed',
    createdAt: issue.created_at,
    closedAt: issue.closed_at ?? null,
    url: issue.html_url,
    submittedBy: extractSubmittedBy(issue.body),
  }));

  return NextResponse.json(mapped);
}

// Parse the "Submitted by: <name>" footer that the POST handler embeds in the body.
// Caps the name at 100 chars and strips any characters that aren't typical in
// display names, to prevent unexpected content from being surfaced in the UI.
function extractSubmittedBy(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = body.match(/\*Submitted by: (.+?)\*/);
  if (!match) return null;
  const raw = match[1].trim().slice(0, 100);
  // Allow letters, digits, spaces, and common name punctuation only.
  // @ is excluded intentionally – these are display names, not email addresses.
  return /^[\w\s.,'\-+]+$/u.test(raw) ? raw : null;
}

// POST /api/feedback — create a new issue (requires auth)
export async function POST(request: NextRequest) {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'Feedback not configured' }, { status: 503 });
  }

  const sessionUser = await getSessionUserFromCookies();
  if (!sessionUser) {
    return NextResponse.json({ error: 'You must be signed in to submit feedback' }, { status: 401 });
  }

  const body = await request.json();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!title || title.length < 5) {
    return NextResponse.json({ error: 'Title must be at least 5 characters' }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: 'Title must be 200 characters or fewer' }, { status: 400 });
  }
  if (description.length > 5000) {
    return NextResponse.json({ error: 'Description must be 5000 characters or fewer' }, { status: 400 });
  }

  const userName = sessionUser.name ?? sessionUser.email ?? sessionUser.sub ?? 'Unknown user';
  const issueBody = [
    description || '_No description provided._',
    '',
    '---',
    `*Submitted by: ${userName}*`,
  ].join('\n');

  // Ensure the label exists first (idempotent)
  await ensureFeedbackLabel();

  const createRes = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body: issueBody,
        labels: [FEEDBACK_LABEL],
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    console.error('GitHub create issue error', err);
    return NextResponse.json({ error: 'Failed to create issue' }, { status: 502 });
  }

  const created = await createRes.json();
  return NextResponse.json({
    number: created.number,
    title: created.title,
    url: created.html_url,
    createdAt: created.created_at,
  }, { status: 201 });
}

async function ensureFeedbackLabel() {
  const labelUrl = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/labels/${FEEDBACK_LABEL}`;
  const check = await fetch(labelUrl, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (check.status === 404) {
    await fetch(`${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/labels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: FEEDBACK_LABEL, color: '0075ca', description: 'User-submitted feedback' }),
    });
  }
}
