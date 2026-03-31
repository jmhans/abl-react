import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/auth/available-leagues
// Returns active seasons the signed-in user does NOT have a team in.
// Shape: Array<{ league: { _id, name, slug }, season: { _id, year } }>
// Returns [] (not 401) for unauthenticated users — callers decide whether to show.
export async function GET() {
  try {
    const db = await connectToDatabase();

    // 1. All active seasons (with league info)
    const activeSeasons = await db
      .collection('seasons')
      .find({ isActive: true })
      .sort({ year: -1 })
      .toArray();

    if (activeSeasons.length === 0) return NextResponse.json([]);

    // Populate leagues
    const leagueIds = [...new Set(activeSeasons.map((s) => s.leagueId?.toString()))].filter(Boolean);
    const leagues = await db
      .collection('leagues')
      .find({ _id: { $in: leagueIds.map((id) => new ObjectId(id)) } })
      .toArray();
    const leagueMap = new Map(leagues.map((l) => [l._id.toString(), l]));

    // 2. Check session — if no user, return all active seasons (so the UI can show a sign-in CTA)
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');
    let userId: string | null = null;
    if (sessionCookie?.value) {
      try {
        userId = JSON.parse(sessionCookie.value).user?.sub ?? null;
      } catch { /* malformed cookie */ }
    }

    // 3. If logged in, find which active seasons the user already has a team in
    const joinedSeasonIds = new Set<string>();
    if (userId) {
      const myTeams = await db
        .collection('ablteams')
        .find({ 'owners.userId': userId })
        .project({ _id: 1 })
        .toArray();
      const myTeamIds = myTeams.map((t) => t._id);

      if (myTeamIds.length > 0) {
        const joinedSeasons = await db
          .collection('seasons')
          .find({ teamIds: { $in: myTeamIds }, isActive: true })
          .project({ _id: 1 })
          .toArray();
        joinedSeasons.forEach((s) => joinedSeasonIds.add(s._id.toString()));
      }
    }

    // 4. Return active seasons the user hasn't joined
    const available = activeSeasons
      .filter((s) => !joinedSeasonIds.has(s._id.toString()))
      .map((s) => {
        const league = leagueMap.get(s.leagueId?.toString());
        if (!league) return null;
        return {
          league: { _id: league._id, name: league.name, slug: league.slug },
          season: { _id: s._id, year: s.year },
        };
      })
      .filter(Boolean);

    return NextResponse.json(available);
  } catch (error) {
    console.error('Error in /api/auth/available-leagues:', error);
    return NextResponse.json([]);
  }
}

export const dynamic = 'force-dynamic';
