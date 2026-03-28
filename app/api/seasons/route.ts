import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

// GET /api/seasons?league=abl[&status=active|completed][&year=2025]
// Returns seasons, optionally filtered. Includes full team docs when ?populate=teams.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueSlug = searchParams.get('league');
    const status = searchParams.get('status');
    const year = searchParams.get('year');
    const populate = searchParams.get('populate');

    const db = await connectToDatabase();

    // Resolve league slug → _id
    const filter: Record<string, any> = {};
    if (leagueSlug) {
      const league = await db.collection('leagues').findOne({ slug: leagueSlug });
      if (!league) {
        return NextResponse.json({ error: 'League not found' }, { status: 404 });
      }
      filter.leagueId = league._id;
    }
    if (status) filter.status = status;
    if (year) filter.year = Number(year);

    const seasons = await db
      .collection('seasons')
      .find(filter)
      .sort({ year: -1 })
      .toArray();

    // Optionally populate team docs
    if (populate === 'teams') {
      const { ObjectId } = await import('mongodb');
      const allTeamIds = [...new Set(seasons.flatMap(s => (s.teamIds || []).map((id: any) => id.toString())))];
      const teams = await db
        .collection('ablteams')
        .find({ _id: { $in: allTeamIds.map(id => new ObjectId(id)) } })
        .toArray();
      const teamMap = new Map(teams.map(t => [t._id.toString(), t]));

      return NextResponse.json(
        seasons.map(s => ({
          ...s,
          teams: (s.teamIds || []).map((id: any) => teamMap.get(id.toString())).filter(Boolean),
        }))
      );
    }

    return NextResponse.json(seasons);
  } catch (error) {
    console.error('Error fetching seasons:', error);
    return NextResponse.json({ error: 'Failed to fetch seasons' }, { status: 500 });
  }
}
