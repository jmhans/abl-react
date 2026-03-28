const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
const ep = path.resolve(__dirname, '..', '.env.local');
for (const l of fs.readFileSync(ep, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('abl_dev');

  // Check how many results entries each game has
  const resultsCounts = await db.collection('games').aggregate([
    { $project: { resultsCount: { $size: { $ifNull: ['$results', []] } }, gameDate: 1, gameType: 1 } },
    { $group: { _id: '$resultsCount', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  console.log('Games by results array length:');
  resultsCounts.forEach(r => console.log(`  ${r._id} results: ${r.count} games`));

  // Show a game that has >1 result
  const multiResult = await db.collection('games').findOne({
    $expr: { $gt: [{ $size: { $ifNull: ['$results', []] } }, 1] }
  });
  if (multiResult) {
    console.log('\nSample game with multiple results:');
    console.log('  gameDate:', multiResult.gameDate);
    console.log('  gameType:', multiResult.gameType);
    console.log('  results count:', multiResult.results.length);
    multiResult.results.forEach((r, i) => {
      console.log(`  result[${i}]: status=${r.status}, winner=${r.winner}, loser=${r.loser}`);
    });
  }

  // Total games × 2 teams should equal sum of all outcomes
  const total = await db.collection('games').countDocuments();
  const standings = await db.collection('standings_view').find({}).toArray();
  const totalG = standings.reduce((s, t) => s + (t.g || 0), 0);
  console.log(`\nTotal game docs: ${total}, expected total team-games (×2): ${total * 2}`);
  console.log(`Sum of all teams' G in standings_view: ${totalG}`);
  console.log(`Expected (each game counts for 2 teams): ${total * 2}`);

  await client.close();
})().catch(e => console.error('Error:', e));
