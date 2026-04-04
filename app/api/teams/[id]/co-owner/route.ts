import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// POST /api/teams/[id]/co-owner
// Body: { userId, name, email }
// Auth: caller must already be an owner of the team.
export async function POST(
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
    try {
      callerId = JSON.parse(sessionCookie.value).user?.sub;
    } catch {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    if (!callerId) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const body = await request.json();
    const { userId, name, email } = body;
    if (!userId || !name) {
      return NextResponse.json({ error: 'userId and name are required' }, { status: 400 });
    }

    const db = await connectToDatabase();

    // Load team
    const team = await db.collection('ablteams').findOne({ _id: new ObjectId(id) });
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    // Verify caller is an existing owner
    const callerIsOwner = (team.owners ?? []).some((o: any) => o.userId === callerId);
    if (!callerIsOwner) {
      return NextResponse.json({ error: 'Only an existing owner can add a co-owner' }, { status: 403 });
    }

    // Check not already an owner
    const alreadyOwner = (team.owners ?? []).some((o: any) => o.userId === userId);
    if (alreadyOwner) {
      return NextResponse.json({ error: 'This user is already an owner of this team' }, { status: 409 });
    }

    const newOwner = {
      _id: new ObjectId(),
      userId,
      name,
      email: email ?? '',
      verified: true,
    };

    await db.collection('ablteams').updateOne(
      { _id: new ObjectId(id) },
      { $push: { owners: newOwner } } as any
    );

    const updated = await db.collection('ablteams').findOne({ _id: new ObjectId(id) });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error in POST /api/teams/[id]/co-owner:', error);
    return NextResponse.json({ error: 'Failed to add co-owner' }, { status: 500 });
  }
}

// DELETE /api/teams/[id]/co-owner
// Body: { userId }
// Auth: caller must be an owner; cannot remove yourself if you're the only owner.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    let callerId: string;
    try {
      callerId = JSON.parse(sessionCookie.value).user?.sub;
    } catch {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await request.json();
    const { userId } = body;
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

    const db = await connectToDatabase();
    const team = await db.collection('ablteams').findOne({ _id: new ObjectId(id) });
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const callerIsOwner = (team.owners ?? []).some((o: any) => o.userId === callerId);
    if (!callerIsOwner) {
      return NextResponse.json({ error: 'Only an existing owner can remove a co-owner' }, { status: 403 });
    }

    if (team.owners?.length <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last owner' }, { status: 400 });
    }

    await db.collection('ablteams').updateOne(
      { _id: new ObjectId(id) },
      { $pull: { owners: { userId } } } as any
    );

    const updated = await db.collection('ablteams').findOne({ _id: new ObjectId(id) });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error in DELETE /api/teams/[id]/co-owner:', error);
    return NextResponse.json({ error: 'Failed to remove co-owner' }, { status: 500 });
  }
}
