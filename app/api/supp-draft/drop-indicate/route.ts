import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getSessionUserFromCookies, isAdminUser } from '@/app/lib/admin-auth';
import { resolveLeagueContext } from '@/app/lib/league-context';
import { MAX_DROP_INDICATIONS } from '@/app/lib/supp-draft-utils';

// GET /api/supp-draft/drop-indicate?league=abl&season=2026
// Returns the drop indications for the calling user's team (or all teams for admin)
export async function GET(request: NextRequest) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const db = await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const leagueSlug = searchParams.get('league') || 'abl';
    const seasonSlug = searchParams.get('season') || 'active';
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const draft = await db.collection('supp_drafts').findOne(
      {
        status: { $in: ['pending', 'active'] },
        leagueId: league._id.toString(),
        seasonId: season._id.toString(),
      },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No active supp draft found' }, { status: 404 });
    }

    const admin = isAdminUser(sessionUser);
    const allIndications = draft.dropIndications || [];

    if (admin) {
      return NextResponse.json({ dropIndications: allIndications });
    }

    // For non-admin: find the teams owned by this user in this season, return only their indications
    const seasonTeamIds = (season.teamIds || []).map((id: any) =>
      typeof id === 'string' ? new ObjectId(id) : id
    );
    const ownedTeams = await db.collection('ablteams').find({
      _id: { $in: seasonTeamIds },
      $or: [
        { 'owners.userId': sessionUser.sub },
        { 'owners.email': sessionUser.email?.toLowerCase() },
      ],
    }).toArray();

    const ownedTeamIds = new Set(ownedTeams.map((t: any) => t._id.toString()));
    const myIndications = allIndications.filter((d: any) => ownedTeamIds.has(d.teamId));

    return NextResponse.json({ dropIndications: myIndications });
  } catch (error) {
    console.error('Error fetching drop indications:', error);
    return NextResponse.json({ error: 'Failed to fetch drop indications' }, { status: 500 });
  }
}

// POST /api/supp-draft/drop-indicate
// Body: { league, season, teamId, playerId }
// Adds a drop indication (up to MAX_DROP_INDICATIONS per team)
export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const db = await connectToDatabase();
    const body = await request.json();
    const leagueSlug = String(body.league || 'abl');
    const seasonSlug = String(body.season || 'active');
    const teamId = String(body.teamId || '');
    const playerId = String(body.playerId || '');

    if (!teamId || !ObjectId.isValid(teamId)) {
      return NextResponse.json({ error: 'Valid teamId is required' }, { status: 400 });
    }
    if (!playerId || !ObjectId.isValid(playerId)) {
      return NextResponse.json({ error: 'Valid playerId is required' }, { status: 400 });
    }

    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const draft = await db.collection('supp_drafts').findOne(
      {
        status: 'pending', // Drop indications only allowed before draft starts
        leagueId: league._id.toString(),
        seasonId: season._id.toString(),
      },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json(
        { error: 'No pending supp draft found — drop indications are only accepted before the draft starts' },
        { status: 404 }
      );
    }

    // Authorization: must be admin or owner of the team
    const admin = isAdminUser(sessionUser);
    if (!admin) {
      const team = await db.collection('ablteams').findOne({ _id: new ObjectId(teamId) });
      const owners: Array<{ userId?: string; email?: string }> = team?.owners ?? [];
      const ownsTeam = owners.some(
        (o) =>
          (o.userId && sessionUser.sub && o.userId === sessionUser.sub) ||
          (o.email && sessionUser.email && o.email.toLowerCase() === sessionUser.email?.toLowerCase())
      );
      if (!ownsTeam) {
        return NextResponse.json({ error: 'You are not the owner of this team' }, { status: 403 });
      }
    }

    // Verify player is on this team's roster as a draft pick
    const effectiveDate = await getLatestEffectiveDateForTeam(db, teamId);
    const lineup = effectiveDate
      ? await db.collection('lineups').findOne({ ablTeam: new ObjectId(teamId), effectiveDate })
      : null;
    const rosterEntry = lineup?.roster?.find((r: any) => r.player.toString() === playerId);

    if (!rosterEntry || rosterEntry.acqType !== 'draft') {
      return NextResponse.json(
        { error: 'Player is not a draft pick on this team roster' },
        { status: 400 }
      );
    }

    // Check existing drop indications for this team
    const existing = (draft.dropIndications || []).filter((d: any) => d.teamId === teamId);

    if (existing.some((d: any) => d.playerId === playerId)) {
      return NextResponse.json({ error: 'Player already indicated for drop' }, { status: 409 });
    }

    if (existing.length >= MAX_DROP_INDICATIONS) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_DROP_INDICATIONS} drop indications allowed per team` },
        { status: 400 }
      );
    }

    const indication = {
      teamId,
      playerId,
      indicatedAt: new Date().toISOString(),
    };

    await db.collection('supp_drafts').updateOne(
      { _id: draft._id },
      { $push: { dropIndications: indication } } as any
    );

    return NextResponse.json({ indication });
  } catch (error) {
    console.error('Error adding drop indication:', error);
    return NextResponse.json({ error: 'Failed to add drop indication' }, { status: 500 });
  }
}

// DELETE /api/supp-draft/drop-indicate
// Body: { league, season, teamId, playerId }
// Removes a drop indication
export async function DELETE(request: NextRequest) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const db = await connectToDatabase();
    const body = await request.json();
    const leagueSlug = String(body.league || 'abl');
    const seasonSlug = String(body.season || 'active');
    const teamId = String(body.teamId || '');
    const playerId = String(body.playerId || '');

    if (!teamId || !playerId) {
      return NextResponse.json({ error: 'teamId and playerId are required' }, { status: 400 });
    }

    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const draft = await db.collection('supp_drafts').findOne(
      {
        status: 'pending',
        leagueId: league._id.toString(),
        seasonId: season._id.toString(),
      },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No pending supp draft found' }, { status: 404 });
    }

    // Authorization
    const admin = isAdminUser(sessionUser);
    if (!admin) {
      const team = await db.collection('ablteams').findOne({ _id: new ObjectId(teamId) });
      const owners: Array<{ userId?: string; email?: string }> = team?.owners ?? [];
      const ownsTeam = owners.some(
        (o) =>
          (o.userId && sessionUser.sub && o.userId === sessionUser.sub) ||
          (o.email && sessionUser.email && o.email.toLowerCase() === sessionUser.email?.toLowerCase())
      );
      if (!ownsTeam) {
        return NextResponse.json({ error: 'You are not the owner of this team' }, { status: 403 });
      }
    }

    await db.collection('supp_drafts').updateOne(
      { _id: draft._id },
      { $pull: { dropIndications: { teamId, playerId } } } as any
    );

    return NextResponse.json({ removed: true });
  } catch (error) {
    console.error('Error removing drop indication:', error);
    return NextResponse.json({ error: 'Failed to remove drop indication' }, { status: 500 });
  }
}

/** Helper: get the most recent effectiveDate for a team's lineup */
async function getLatestEffectiveDateForTeam(db: any, teamId: string): Promise<string | null> {
  const lineup = await db.collection('lineups').findOne(
    { ablTeam: new ObjectId(teamId) },
    { sort: { effectiveDate: -1 }, projection: { effectiveDate: 1 } }
  );
  return lineup?.effectiveDate ?? null;
}
