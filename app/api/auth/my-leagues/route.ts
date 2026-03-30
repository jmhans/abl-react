import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/auth/my-leagues
// Returns the leagues + seasons the currently signed-in user has a team in.
// Shape: Array<{ team, season, league }>
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');
    if (!sessionCookie?.value) {
      return NextResponse.json([]);
    }

    let userId: string;
    try {
      userId = JSON.parse(sessionCookie.value).user?.sub;
    } catch {
      return NextResponse.json([]);
    }
    if (!userId) return NextResponse.json([]);

    const db = await connectToDatabase();

    // 1. Find all teams this user owns
    const myTeams = await db
      .collection('ablteams')
      .find({ 'owners.userId': userId })
      .toArray();

    if (myTeams.length === 0) return NextResponse.json([]);

    const myTeamIds = myTeams.map((t) => t._id);

    // 2. Find all seasons that contain any of my teams
    const seasons = await db
      .collection('seasons')
      .find({ teamIds: { $in: myTeamIds } })
      .sort({ year: -1 })
      .toArray();

    if (seasons.length === 0) return NextResponse.json([]);

    // 3. Populate leagues
    const leagueIds = [...new Set(seasons.map((s) => s.leagueId?.toString()))].filter(Boolean);
    const leagues = await db
      .collection('leagues')
      .find({ _id: { $in: leagueIds.map((id) => new ObjectId(id)) } })
      .toArray();
    const leagueMap = new Map(leagues.map((l) => [l._id.toString(), l]));

    // 4. Match each season to the user's team and league
    const myTeamMap = new Map(myTeams.map((t) => [t._id.toString(), t]));

    const result = seasons.map((season) => {
      const league = leagueMap.get(season.leagueId?.toString()) ?? null;
      const myTeamId = (season.teamIds ?? []).find((tid: any) =>
        myTeamMap.has(tid.toString())
      );
      const team = myTeamId ? myTeamMap.get(myTeamId.toString()) : null;
      return { team, season, league };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in /api/auth/my-leagues:', error);
    return NextResponse.json([]);
  }
}

export const dynamic = 'force-dynamic';
