import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { refreshPersistedLiveSplits } from '@/app/lib/stat-splits';

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

async function handleRefresh(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const searchParams = request.nextUrl.searchParams;

  const leagueSlug = (body?.league as string | undefined) || searchParams.get('league') || 'abl';
  const seasonSlug = (body?.season as string | undefined) || searchParams.get('season') || 'active';

  try {
    const db = await connectToDatabase();
    const summary = await refreshPersistedLiveSplits(db, { leagueSlug, seasonSlug });

    return NextResponse.json(
      {
        ok: true,
        league: leagueSlug,
        season: seasonSlug,
        liveSplitsSummary: summary,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Live splits refresh failed:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Live splits refresh failed',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handleRefresh(request);
}

export async function GET(request: NextRequest) {
  return handleRefresh(request);
}

export const dynamic = 'force-dynamic';
