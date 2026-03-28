import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

// GET /api/leagues — list all leagues
export async function GET(_req: NextRequest) {
  try {
    const db = await connectToDatabase();
    const leagues = await db.collection('leagues').find({}).toArray();
    return NextResponse.json(leagues);
  } catch (error) {
    console.error('Error fetching leagues:', error);
    return NextResponse.json({ error: 'Failed to fetch leagues' }, { status: 500 });
  }
}

// POST /api/leagues — create a new league
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, slug, description } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: 'name and slug are required' }, { status: 400 });
    }

    const slugNorm = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const db = await connectToDatabase();

    const existing = await db.collection('leagues').findOne({ slug: slugNorm });
    if (existing) {
      return NextResponse.json({ error: `Slug "${slugNorm}" is already taken` }, { status: 409 });
    }

    const doc = {
      name: name.trim(),
      slug: slugNorm,
      description: description?.trim() ?? '',
      createdAt: new Date(),
    };
    const result = await db.collection('leagues').insertOne(doc);
    const league = await db.collection('leagues').findOne({ _id: result.insertedId });
    return NextResponse.json(league, { status: 201 });
  } catch (error) {
    console.error('Error creating league:', error);
    return NextResponse.json({ error: 'Failed to create league' }, { status: 500 });
  }
}
