import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { runDailyStatRefresh } from '@/app/lib/stat-refresh-service';
import { getAdminAuthState } from '@/app/lib/admin-auth';

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

function parseTargetDate(rawDate?: string | null): Date {
  if (rawDate) {
    const dt = new Date(`${rawDate}T00:00:00.000Z`);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
  }

  const now = new Date();
  const yesterdayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0, 0));
  return yesterdayUtc;
}

function parseDate(rawDate?: string | null): Date | null {
  if (!rawDate) return null;
  const dt = new Date(`${rawDate}T00:00:00.000Z`);
  return !Number.isNaN(dt.getTime()) ? dt : null;
}

async function handleRefresh(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const searchParams = request.nextUrl.searchParams;

  const dateParam = (body?.date as string | undefined) || searchParams.get('date');
  const dateStartParam = (body?.dateStart as string | undefined) || searchParams.get('dateStart');
  const dateEndParam = (body?.dateEnd as string | undefined) || searchParams.get('dateEnd');
  const recalcParam = body?.recalculate ?? searchParams.get('recalculate');
  const recalculate = recalcParam === undefined ? true : String(recalcParam) !== 'false';

  try {
    const db = await connectToDatabase();

    // If date range provided, loop through all dates; otherwise single date
    if (dateStartParam && dateEndParam) {
      const startDate = parseDate(dateStartParam);
      const endDate = parseDate(dateEndParam);
      
      if (!startDate || !endDate) {
        return NextResponse.json(
          { ok: false, error: 'Invalid dateStart or dateEnd format' },
          { status: 400 }
        );
      }

      const results = []; 
      let totalScheduledGames = 0;
      let totalPlayersUpdated = 0;
      let totalStatlinesUpdated = 0;
      let totalRecalcProcessed = 0;
      let totalRecalcSkipped = 0;
      let totalRecalcErrors = 0;

      for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        const summary = await runDailyStatRefresh(db, new Date(d), { recalculate });
        
        totalScheduledGames += summary.refreshSummary?.scheduledGames ?? 0;
        totalPlayersUpdated += summary.refreshSummary?.playersUpdated ?? 0;
        totalStatlinesUpdated += summary.refreshSummary?.statlinesUpdated ?? 0;

        if (recalculate && summary.recalcSummary) {
          totalRecalcProcessed += summary.recalcSummary.processed ?? 0;
          totalRecalcSkipped += summary.recalcSummary.skipped ?? 0;
          totalRecalcErrors += summary.recalcSummary.errors ?? 0;
        }

        results.push({
          date: new Date(d).toISOString().substring(0, 10),
          scheduledGames: summary.refreshSummary?.scheduledGames ?? 0,
          playersUpdated: summary.refreshSummary?.playersUpdated ?? 0,
          statlinesUpdated: summary.refreshSummary?.statlinesUpdated ?? 0,
        });
      }

      return NextResponse.json(
        {
          ok: true,
          dateRange: {
            start: startDate.toISOString().substring(0, 10),
            end: endDate.toISOString().substring(0, 10),
          },
          recalculate,
          refreshSummary: {
            scheduledGames: totalScheduledGames,
            playersUpdated: totalPlayersUpdated,
            statlinesUpdated: totalStatlinesUpdated,
          },
          ...(recalculate && {
            recalcSummary: {
              processed: totalRecalcProcessed,
              skipped: totalRecalcSkipped,
              errors: totalRecalcErrors,
            },
          }),
          daysProcessed: results.length,
          byDay: results,
        },
        { status: 200 }
      );
    }

    // Single date mode (original behavior)
    const targetDate = parseTargetDate(dateParam);
    const summary = await runDailyStatRefresh(db, targetDate, { recalculate });

    return NextResponse.json(
      {
        ok: true,
        targetDate: targetDate.toISOString().substring(0, 10),
        recalculate,
        ...summary,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Daily stat refresh failed:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Daily stat refresh failed',
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
