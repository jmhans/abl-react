import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/teams/:id - Get a single team
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();
    
    const team = await db.collection('ablteams').findOne({ _id: new ObjectId(id) });
    
    if (!team) {
      return NextResponse.json(
        { error: 'Team not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(team);
  } catch (error) {
    console.error('Error fetching team:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team' },
      { status: 500 }
    );
  }
}

// PUT /api/teams/:id - Update a team
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();
    const body = await request.json();
    
    const result = await db.collection('ablteams').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: body },
      { returnDocument: 'after', upsert: true }
    );
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error updating team:', error);
    return NextResponse.json(
      { error: 'Failed to update team' },
      { status: 500 }
    );
  }
}

// PATCH /api/teams/:id - Partial update (owner-only: location, nickname, stadium)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    let callerId: string;
    try { callerId = JSON.parse(sessionCookie.value).user?.sub; }
    catch { return NextResponse.json({ error: 'Invalid session' }, { status: 401 }); }
    if (!callerId) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const db = await connectToDatabase();
    const team = await db.collection('ablteams').findOne({ _id: new ObjectId(id) });
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const isOwner = (team.owners ?? []).some((o: any) => o.userId === callerId);
    if (!isOwner) {
      return NextResponse.json({ error: 'Only a team owner can edit team info' }, { status: 403 });
    }

    const body = await request.json();
    // Only allow safe editable fields
    const allowed = ['location', 'nickname', 'stadium'];
    const update: Record<string, any> = {};
    for (const key of allowed) {
      if (key in body) update[key] = body[key];
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }

    const result = await db.collection('ablteams').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error patching team:', error);
    return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });
  }
}

// DELETE /api/teams/:id - Delete a team
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await connectToDatabase();
    
    const result = await db.collection('ablteams').findOneAndDelete({ _id: new ObjectId(id) });
    
    if (!result) {
      return NextResponse.json(
        { error: 'Team not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error deleting team:', error);
    return NextResponse.json(
      { error: 'Failed to delete team' },
      { status: 500 }
    );
  }
}
