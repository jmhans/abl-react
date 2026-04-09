import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { resolveLeagueContext } from '@/app/lib/league-context';

// PATCH /api/draft/start
// Sets startedAt on the active draft, officially opening picks.
export async function PATCH(request: NextRequest) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const leagueSlug = searchParams.get('league') || 'abl';
    const seasonSlug = searchParams.get('season') || 'active';

    const db = await connectToDatabase();
    const { league, season } = await resolveLeagueContext(db, leagueSlug, seasonSlug);

    const draft = await db.collection('drafts').findOne(
      { status: 'active', leagueId: league._id.toString(), seasonId: season._id.toString() },
      { sort: { createdAt: -1 } }
    );

    if (!draft) {
      return NextResponse.json({ error: 'No active draft found' }, { status: 404 });
    }

    if (draft.startedAt) {
      return NextResponse.json({ error: 'Draft has already been started' }, { status: 409 });
    }

    const startedAt = new Date();
    await db.collection('drafts').updateOne(
      { _id: draft._id },
      { $set: { startedAt } }
    );

    return NextResponse.json({ startedAt: startedAt.toISOString() });
  } catch (error) {
    console.error('Error starting draft:', error);
    return NextResponse.json({ error: 'Failed to start draft' }, { status: 500 });
  }
}
