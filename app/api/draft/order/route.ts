import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';

export async function PATCH(request: NextRequest) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String) : null;

    if (!orderIds || orderIds.length === 0) {
      return NextResponse.json({ error: 'orderIds are required' }, { status: 400 });
    }

    const db = await connectToDatabase();
    const draft = await db.collection('drafts').findOne({ status: 'active' }, { sort: { createdAt: -1 } });

    if (!draft) {
      return NextResponse.json({ error: 'No active draft found' }, { status: 404 });
    }

    if ((draft.picks || []).length > 0) {
      return NextResponse.json({ error: 'Order is locked after draft starts' }, { status: 400 });
    }

    const teams = await db.collection('ablteams').find({}).toArray();
    const validTeamIds = new Set(teams.map((team: any) => String(team._id)));

    if (
      orderIds.length !== teams.length ||
      orderIds.some((id: string) => !validTeamIds.has(id))
    ) {
      return NextResponse.json({ error: 'Invalid team orderIds' }, { status: 400 });
    }

    await db.collection('drafts').updateOne(
      { _id: draft._id },
      { $set: { orderIds } }
    );

    return NextResponse.json({ success: true, orderIds });
  } catch (error) {
    console.error('Error updating draft order:', error);
    return NextResponse.json({ error: 'Failed to update draft order' }, { status: 500 });
  }
}
