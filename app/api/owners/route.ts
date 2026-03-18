import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/owners - Get all owners
export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const owners = await db.collection('owners').find({}).toArray();
    
    return NextResponse.json(owners);
  } catch (error) {
    console.error('Error fetching owners:', error);
    return NextResponse.json(
      { error: 'Failed to fetch owners' },
      { status: 500 }
    );
  }
}

// POST /api/owners - Create a new owner
export async function POST(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const body = await request.json();
    
    const result = await db.collection('owners').insertOne(body);
    const owner = await db.collection('owners').findOne({ _id: result.insertedId });
    
    return NextResponse.json(owner, { status: 201 });
  } catch (error) {
    console.error('Error creating owner:', error);
    return NextResponse.json(
      { error: 'Failed to create owner' },
      { status: 500 }
    );
  }
}
