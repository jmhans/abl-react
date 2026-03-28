import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/seasons/[id] — fetch a single season with populated teams
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const db = await connectToDatabase();
    const season = await db.collection('seasons').findOne({ _id: new ObjectId(id) });
    if (!season) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    // Populate league
    const league = await db.collection('leagues').findOne({ _id: season.leagueId });

    // Populate teams
    const teamIds: ObjectId[] = (season.teamIds ?? []).map((tid: any) =>
      tid instanceof ObjectId ? tid : new ObjectId(tid)
    );
    const teams = teamIds.length
      ? await db.collection('ablteams').find({ _id: { $in: teamIds } }).toArray()
      : [];

    return NextResponse.json({ ...season, league, teams });
  } catch (error) {
    console.error('Error fetching season:', error);
    return NextResponse.json({ error: 'Failed to fetch season' }, { status: 500 });
  }
}

// PATCH /api/seasons/[id] — update season fields
// Body: { teamIds?: string[], status?: string, isActive?: boolean }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await req.json();
    const update: Record<string, any> = {};

    if (Array.isArray(body.teamIds)) {
      update.teamIds = body.teamIds.map((tid: string) => new ObjectId(tid));
    }
    if (body.status !== undefined) update.status = body.status;
    if (body.isActive !== undefined) update.isActive = body.isActive;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const db = await connectToDatabase();
    const result = await db
      .collection('seasons')
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: update },
        { returnDocument: 'after' }
      );

    if (!result) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error updating season:', error);
    return NextResponse.json({ error: 'Failed to update season' }, { status: 500 });
  }
}
