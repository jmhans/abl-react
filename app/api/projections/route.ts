/**
 * GET  /api/projections?season=2026&system=Steamer  — list summary
 * DELETE /api/projections?season=2026&system=Steamer — clear records
 */

import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const season = request.nextUrl.searchParams.get('season');
    const system = request.nextUrl.searchParams.get('system');

    const filter: Record<string, any> = {};
    if (season) filter.season = Number(season);
    if (system) filter.projSystem = system;

    // Return summary grouped by season + system rather than all docs
    const summary = await db
      .collection('projections')
      .aggregate([
        { $match: filter },
        {
          $group: {
            _id: { season: '$season', projSystem: '$projSystem' },
            count: { $sum: 1 },
            matched: { $sum: { $cond: [{ $ne: ['$mlbId', null] }, 1, 0] } },
            lastImport: { $max: '$importedAt' },
          },
        },
        { $sort: { '_id.season': -1, '_id.projSystem': 1 } },
      ])
      .toArray();

    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch projections' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const season = request.nextUrl.searchParams.get('season');
    const system = request.nextUrl.searchParams.get('system');

    const filter: Record<string, any> = {};
    if (season) filter.season = Number(season);
    if (system) filter.projSystem = system;

    const result = await (await connectToDatabase()).collection('projections').deleteMany(filter);
    return NextResponse.json({ deleted: result.deletedCount });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete projections' }, { status: 500 });
  }
}
