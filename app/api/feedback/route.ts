import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserFromCookies } from '@/app/lib/admin-auth';

const GITHUB_TOKEN = process.env.GITHUB_FEEDBACK_TOKEN;
const REPO_OWNER = 'jmhans';
const REPO_NAME = 'abl-react';
const FEEDBACK_LABEL = 'feedback';
const GITHUB_API = 'https://api.github.com';

// GET /api/feedback — list open issues labelled 'feedback'
export async function GET() {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'Feedback not configured' }, { status: 503 });
  }

  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/issues?labels=${FEEDBACK_LABEL}&state=open&per_page=50&sort=created&direction=desc`;

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
    state: issue.state,
    createdAt: issue.created_at,
    url: issue.html_url,
    user: issue.user?.login ?? null,
  }));

  return NextResponse.json(mapped);
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
