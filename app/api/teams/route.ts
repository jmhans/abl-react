import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { getDisplayNameMap, sanitizeDisplayName } from '@/app/lib/display-name';

function populateOwnerNames(teams: any[], nameMap: Map<string, string>) {
  for (const team of teams) {
    if (!Array.isArray(team.owners)) continue;
    for (const owner of team.owners) {
      if (!owner.userId) continue;
      const display = nameMap.get(owner.userId);
      if (display) {
        owner.name = display;
      } else if (!owner.name || owner.name === owner.userId) {
        // Fall back to a sanitized version of whatever name Auth0 gave us
        owner.name = sanitizeDisplayName(owner.name, owner.userId);
      }
    }
  }
}

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
      const userIds = teams.flatMap((t: any) => (t.owners ?? []).map((o: any) => o.userId).filter(Boolean));
      const nameMap = await getDisplayNameMap(db, userIds);
      populateOwnerNames(teams, nameMap);
      return NextResponse.json(teams);
    }

    // No filter — return all teams (admin / legacy use)
    const teams = await db.collection('ablteams').find({}).toArray();
    const userIds = teams.flatMap((t: any) => (t.owners ?? []).map((o: any) => o.userId).filter(Boolean));
    const nameMap = await getDisplayNameMap(db, userIds);
    populateOwnerNames(teams, nameMap);
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
