import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { processPlayoffsForAllSeasons } from '@/app/lib/playoff-service';

// GET/POST /api/jobs/process-playoffs
// Daily cron: advances each league/season's playoff state machine one step —
// detects regular-season completion, creates/evaluates tiebreak games, creates and
// progresses the bracket series. Safe to run repeatedly; each step is idempotent.
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const { isAdmin } = await getAdminAuthState();
  if (isAdmin) return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
  const headerSecret = request.headers.get('x-cron-secret') || '';

  return token === secret || headerSecret === secret;
}

async function handleProcessPlayoffs(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = await connectToDatabase();
    const results = await processPlayoffsForAllSeasons(db);
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error('process-playoffs failed:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleProcessPlayoffs(request);
}

export async function POST(request: NextRequest) {
  return handleProcessPlayoffs(request);
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
