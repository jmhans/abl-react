import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

// GET /api/debug/db - Check database connection and collections
export async function GET(request: NextRequest) {
  try {
    console.log('Debug route called');
    const db = await connectToDatabase();
    console.log('Connected to database:', db.databaseName);
    
    // Get list of all collections
    const collections = await db.listCollections().toArray();
    console.log('Found collections:', collections);
    const collectionNames = collections.map(c => c.name);
    
    // Get count from each collection
    const counts: Record<string, number> = {};
    for (const name of collectionNames) {
      const count = await db.collection(name).countDocuments();
      counts[name] = count;
      console.log(`Collection ${name}: ${count} documents`);
    }
    
    const response = {
      database: db.databaseName,
      collections: collectionNames,
      counts,
      status: 'connected'
    };
    
    console.log('Sending response:', response);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Database debug error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to connect to database',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
