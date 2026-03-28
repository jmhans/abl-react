import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { calculateAblScore } from '@/app/lib/roster-utils';

// GET /api/free-agents - Get paginated list of free agents
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';
    const showAll = searchParams.get('showAll') === 'true';

    const skip = (page - 1) * limit;

    // Build search query
    const query: any = {
      'ablstatus.onRoster': { $ne: true }
    };

    // Only filter by Active status if not showing all
    if (!showAll) {
      query.status = 'Active';
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { mlbID: { $regex: search, $options: 'i' } }
      ];
    }

    // Get total count
    const total = await db.collection('players_view').countDocuments(query);

    // Get paginated results with rich stats
    let players = await db.collection('players_view')
      .find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Calculate ABL scores
    players = players.map((p: any) => ({
      ...p,
      abl: calculateAblScore(p.stats)
    }));

    return NextResponse.json({
      players,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Free agents error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch free agents' },
      { status: 500 }
    );
  }
}
