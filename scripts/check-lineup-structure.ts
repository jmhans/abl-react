import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI!;

async function checkLineupStructure() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db();
    
    // Get one sample lineup document
    const sampleLineup = await db.collection('lineups').findOne({});
    
    if (sampleLineup) {
      console.log('\n=== Sample Lineup Document Structure ===');
      console.log('Fields:', Object.keys(sampleLineup));
      console.log('\nFull document:');
      console.log(JSON.stringify(sampleLineup, null, 2));
    } else {
      console.log('No lineup documents found');
    }

    // Count total lineups
    const count = await db.collection('lineups').countDocuments();
    console.log(`\nTotal lineups in collection: ${count}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkLineupStructure();
