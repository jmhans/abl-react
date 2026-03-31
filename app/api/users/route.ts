import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';

// GET /api/users
// Returns all unique users known to the system (aggregated from ablteams owners arrays).
// Auth required — only signed-in users can see the list.
export async function GET() {
  try {
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

    const db = await connectToDatabase();

    // Unwind all owners across all teams, deduplicate by userId
    const users = await db.collection('ablteams').aggregate([
      { $unwind: '$owners' },
      { $replaceRoot: { newRoot: '$owners' } },
      { $group: {
          _id: '$userId',
          userId: { $first: '$userId' },
          name: { $first: '$name' },
          email: { $first: '$email' },
      }},
      { $project: { _id: 0, userId: 1, name: 1, email: 1 } },
      { $sort: { name: 1 } },
    ]).toArray();

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error in /api/users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
