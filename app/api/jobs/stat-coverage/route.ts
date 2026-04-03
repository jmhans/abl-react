import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';

const SEASON_START = '2026-03-26'; // 2026 MLB Opening Day

function ymd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function GET() {
  const { isAdmin } = await getAdminAuthState();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = await connectToDatabase();

  // All stat-coverage docs from season start forward (compact format: _id is "YYYY-MM-DD")
  const docs = await db
    .collection('statlines')
    .find(
      { _id: { $gte: SEASON_START as any } },
      { projection: { _id: 1 } },
    )
    .toArray();

  const coveredSet = new Set(docs.map((d) => String(d._id)));

  // Compute missing dates: season start → yesterday UTC
  const now = new Date();
  const yesterday = ymd(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)),
  );

  const missingDates: string[] = [];
  const startDate = new Date(`${SEASON_START}T00:00:00.000Z`);
  const endDate = new Date(`${yesterday}T00:00:00.000Z`);

  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = ymd(d);
    if (!coveredSet.has(key)) {
      missingDates.push(key);
    }
  }

  // Most recent covered date
  const sortedCovered = [...coveredSet].filter((k) => k <= yesterday).sort();
  const lastDate = sortedCovered.length > 0 ? sortedCovered[sortedCovered.length - 1] : null;

  return NextResponse.json({
    seasonStart: SEASON_START,
    yesterday,
    lastDate,
    coveredCount: sortedCovered.length,
    missingDates,
  });
}
