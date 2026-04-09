import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';

// GET /api/teams?league=abl&season=2025 - Get teams, optionally scoped to a season
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const leagueSlug = searchParams.get('league');
    const seasonSlug = searchParams.get('season');

    if (leagueSlug && seasonSlug) {
      // Return only the teams assigned to this specific season
      const ctx = await resolveLeagueContext(db, leagueSlug, seasonSlug);
      const teamIds = ctx.season.teamIds ?? [];
      if (teamIds.length === 0) return NextResponse.json([]);
      
      // teamIds could be strings or ObjectIds depending on data source
      const teams = await db.collection('ablteams')
        .find({ _id: { $in: teamIds } })
        .toArray();
      return NextResponse.json(teams);
    }

    // No filter — return all teams (admin / legacy use)
    const teams = await db.collection('ablteams').find({}).toArray();
    return NextResponse.json(teams);
  } catch (error) {
    console.error('Error fetching teams:', error);
    return NextResponse.json(
      { error: 'Failed to fetch teams' },
      { status: 500 }
    );
  }
}

// POST /api/teams - Create a new team
export async function POST(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const body = await request.json();
    
    const result = await db.collection('ablteams').insertOne(body);
    const team = await db.collection('ablteams').findOne({ _id: result.insertedId });
    
    return NextResponse.json(team, { status: 201 });
  } catch (error) {
    console.error('Error creating team:', error);
    return NextResponse.json(
      { error: 'Failed to create team' },
      { status: 500 }
    );
  }
}
