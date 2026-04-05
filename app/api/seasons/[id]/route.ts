import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/seasons/[id] — fetch a single season with populated teams
// [id] can be a MongoDB ObjectId OR a human-readable slug like "abl-2025"
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();

    let season: any = null;

    if (ObjectId.isValid(id)) {
      // Plain ObjectId lookup
      season = await db.collection('seasons').findOne({ _id: new ObjectId(id) });
    } else {
      // Try human-readable slug: "abl-2025" → league slug "abl", year 2025
      const match = id.match(/^(.+)-(\d{4})$/);
      if (match) {
        const [, leagueSlug, yearStr] = match;
        const league = await db.collection('leagues').findOne({ slug: leagueSlug });
        if (league) {
          season = await db.collection('seasons').findOne({
            leagueId: league._id,
            year: Number(yearStr),
          });
        }
      }
    }

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
// [id] can be an ObjectId or "abl-2025" slug
// Body: { teamIds?: string[], status?: string, isActive?: boolean }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();

    // Resolve the season _id from ObjectId or slug
    let seasonObjectId: ObjectId | null = null;
    if (ObjectId.isValid(id)) {
      seasonObjectId = new ObjectId(id);
    } else {
      const match = id.match(/^(.+)-(\d{4})$/);
      if (match) {
        const [, leagueSlug, yearStr] = match;
        const league = await db.collection('leagues').findOne({ slug: leagueSlug });
        if (league) {
          const found = await db.collection('seasons').findOne({
            leagueId: league._id,
            year: Number(yearStr),
          });
          if (found) seasonObjectId = found._id;
        }
      }
    }
    if (!seasonObjectId) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
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

    const result = await db
      .collection('seasons')
      .findOneAndUpdate(
        { _id: seasonObjectId },
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

// DELETE /api/seasons/[id] — delete a season
// [id] can be an ObjectId or "abl-2025" slug
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();

    // Resolve the season _id from ObjectId or slug
    let seasonObjectId: ObjectId | null = null;
    if (ObjectId.isValid(id)) {
      seasonObjectId = new ObjectId(id);
    } else {
      const match = id.match(/^(.+)-(\d{4})$/);
      if (match) {
        const [, leagueSlug, yearStr] = match;
        const league = await db.collection('leagues').findOne({ slug: leagueSlug });
        if (league) {
          const found = await db.collection('seasons').findOne({
            leagueId: league._id,
            year: Number(yearStr),
          });
          if (found) seasonObjectId = found._id;
        }
      }
    }
    if (!seasonObjectId) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    const result = await db.collection('seasons').deleteOne({ _id: seasonObjectId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Error deleting season:', error);
    return NextResponse.json({ error: 'Failed to delete season' }, { status: 500 });
  }
}
