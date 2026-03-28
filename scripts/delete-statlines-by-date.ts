import { MongoClient } from 'mongodb';

// Usage: MONGODB_URI=... npx tsx scripts/delete-statlines-by-date.ts 2025-08-05
// Deletes all statline docs from abl_dev where ablDate matches the given date string.

async function deleteStatlinesByDate(ablDate: string) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('abl_dev');

    const countBefore = await db.collection('statlines').countDocuments({ ablDate });
    console.log(`Found ${countBefore} statline docs with ablDate="${ablDate}" in abl_dev`);

    if (countBefore === 0) {
      console.log('Nothing to delete.');
      return;
    }

    const result = await db.collection('statlines').deleteMany({ ablDate });
    console.log(`Deleted ${result.deletedCount} docs.`);

    const countAfter = await db.collection('statlines').countDocuments({ ablDate });
    console.log(`Remaining docs with ablDate="${ablDate}": ${countAfter}`);
  } finally {
    await client.close();
  }
}

const ablDate = process.argv[2];
if (!ablDate || !/^\d{4}-\d{2}-\d{2}$/.test(ablDate)) {
  console.error('Usage: npx tsx scripts/delete-statlines-by-date.ts YYYY-MM-DD');
  process.exit(1);
}

deleteStatlinesByDate(ablDate).catch((err) => {
  console.error(err);
  process.exit(1);
});
