import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI!;

async function checkStandings() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db();
    
    // Get sample standings document
    const standing = await db.collection('standings_view').findOne({});
    
    if (standing) {
      console.log('\n=== Sample Standing Document ===');
      console.log(JSON.stringify(standing, null, 2));
    } else {
      console.log('No standings found');
    }

    // Get all standings
    const allStandings = await db.collection('standings_view').find({}).toArray();
    console.log(`\nTotal standings: ${allStandings.length}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkStandings();
