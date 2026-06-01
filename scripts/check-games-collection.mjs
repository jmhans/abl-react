import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

console.log('=== GAMES COLLECTION - CHECKING FOR R/S TYPE ===\n');

// Check structure of games collection
const sampleGames = await db.collection('games')
  .find({ date: { $regex: '^2026-03' } })
  .limit(3)
  .toArray();

console.log('Sample games:');
sampleGames.forEach(g => {
  console.log(JSON.stringify({
    _id: g._id,
    date: g.date,
    gameType: g.gameType || g.type || g.gt,
    season: g.season,
    // Show all top-level keys
    keys: Object.keys(g).slice(0, 15)
  }, null, 2));
  console.log('---');
});

// Check distribution of game types in 2026
const typeCount = await db.collection('games').aggregate([
  { $match: { date: { $regex: '^2026' } } },
  { $group: { _id: '$gameType', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray();

console.log('\nGame types in 2026:');
typeCount.forEach(t => {
  console.log(`  ${t._id}: ${t.count}`);
});

const regSeasonStart = await db.collection('games')
  .find({ date: { $regex: '^2026' }, gameType: 'R' })
  .sort({ date: 1 })
  .limit(1)
  .toArray();

if (regSeasonStart.length > 0) {
  console.log(`\nRegular season starts: ${regSeasonStart[0].date}`);
}

await client.close();
