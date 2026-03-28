import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// POST /api/join/[leagueSlug]
// Requires: logged-in session cookie
// Body: { nickname, location, stadium }
// Creates a team in `ablteams` and adds it to the active season for the league.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueSlug: string }> }
) {
  try {
    // Auth check
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let sessionUser: {
      sub: string;
      name: string;
      email?: string;
      picture?: string;
    };
    try {
      sessionUser = JSON.parse(sessionCookie.value).user;
    } catch {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    if (!sessionUser?.sub) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { leagueSlug } = await params;

    const body = await req.json();
    const nickname = body.nickname?.trim();
    const location = body.location?.trim();
    const stadium = body.stadium?.trim();

    if (!nickname || !location || !stadium) {
      return NextResponse.json(
        { error: 'nickname, location, and stadium are required' },
        { status: 400 }
      );
    }

    const db = await connectToDatabase();

    // Resolve league
    const league = await db.collection('leagues').findOne({ slug: leagueSlug });
    if (!league) {
      return NextResponse.json({ error: `League "${leagueSlug}" not found` }, { status: 404 });
    }

    // Find the active season for this league
    const season = await db
      .collection('seasons')
      .findOne({ leagueId: league._id, isActive: true });
    if (!season) {
      return NextResponse.json(
        { error: `No active season found for league "${leagueSlug}"` },
        { status: 404 }
      );
    }

    // Check if this user already owns a team in this season
    const existingTeamIds: ObjectId[] = (season.teamIds ?? []).map((id: any) =>
      id instanceof ObjectId ? id : new ObjectId(id)
    );

    if (existingTeamIds.length > 0) {
      const existingTeam = await db.collection('ablteams').findOne({
        _id: { $in: existingTeamIds },
        'owners.userId': sessionUser.sub,
      });
      if (existingTeam) {
        return NextResponse.json(
          {
            error: 'already_registered',
            message: "You're already in this league!",
            team: existingTeam,
          },
          { status: 409 }
        );
      }
    }

    // Create the team
    const teamDoc = {
      nickname,
      location,
      stadium,
      owners: [
        {
          _id: new ObjectId(),
          userId: sessionUser.sub,
          name: sessionUser.name,
          email: sessionUser.email ?? '',
          verified: true,
        },
      ],
      createdAt: new Date(),
    };

    const insertResult = await db.collection('ablteams').insertOne(teamDoc);
    const team = await db.collection('ablteams').findOne({ _id: insertResult.insertedId });

    // Add team to season's teamIds
    await db.collection('seasons').updateOne(
      { _id: season._id },
      { $addToSet: { teamIds: insertResult.insertedId } }
    );

    return NextResponse.json(
      {
        ok: true,
        team,
        leagueSlug,
        seasonYear: season.year,
        redirectTo: `/${leagueSlug}/${season.year}`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in /api/join:', error);
    return NextResponse.json({ error: 'Failed to register team' }, { status: 500 });
  }
}
