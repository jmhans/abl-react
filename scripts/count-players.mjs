import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('abl_dev');

try {
  const total = await db.collection('players_view').countDocuments();
  const filtered = await db.collection('players_view').countDocuments({
    $or: [
      { 'eligible.0': { $exists: true } },
      { 'stats.batting.atBats': { $gt: 0 } }
    ]
  });
  const withEligible = await db.collection('players_view').countDocuments({ 'eligible.0': { $exists: true } });
  const withABs = await db.collection('players_view').countDocuments({ 'stats.batting.atBats': { $gt: 0 } });

  console.log('=== Player Pool ===');
  console.log('Total in players_view:', total);
  console.log('Filtered (eligible OR ABs > 0):', filtered);
  console.log('  - with eligible positions:', withEligible);
  console.log('  - with ABs > 0:', withABs);
  console.log('Excluded (pure pitchers):', total - filtered);
} finally {
  await client.close();
}
