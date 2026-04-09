import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'abl_dev');

// Count how many 2026 position_log entries there are
const count2026 = await db.collection('position_log').countDocuments({ season: 2026 });
console.log(`Total position_log 2026 entries: ${count2026}`);

// Check timestamp to see when they were last modified
const recent = await db.collection('position_log')
  .find({ season: 2026 })
  .project({ mlbId: 1, _id: 1 })
  .limit(5)
  .toArray();

console.log('\nSample docs (check if _id format suggests recent write):');
console.log(JSON.stringify(recent, null, 2));

// Get position distribution
const dist = await db.collection('position_log').aggregate([
  { $match: { season: 2026 } },
  { $group: { _id: '$maxPosition', cnt: { $sum: 1 } } },
  { $sort: { cnt: -1 } }
]).toArray();

console.log('\nPosition distribution (all should match actual game data):');
console.log(JSON.stringify(dist, null, 2));

// Sample a few players and check if they match actual statlines
const samples = ['467793', '502671', '656976'].map(async mlbId => {
  const posLog = await db.collection('position_log').findOne({ mlbId, season: 2026 });
  const gameCount = await db.collection('statlines').countDocuments({
    _id: { $regex: `^2026-(?:0[1-3]|04-0[0-5])` },
    [`p.${mlbId}_`]: { $exists: true }
  });
  return { mlbId, maxPos: posLog?.maxPosition, actualGameCount: gameCount };
});

console.log('\nSpot checks (maxPosition vs actual game count):');
for (const sample of await Promise.all(samples)) {
  console.log(`  ${sample.mlbId}: maxPos=${sample.maxPos}, gameCount=${sample.actualGameCount}`);
}

await client.close();
