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

const mlbId = '656976';

// Get all statline dates in 2026
console.log(`\n=== All 2026 statline dates ===`);
const dates = await db.collection('statlines')
  .find({ _id: /^2026-/ })
  .project({ _id: 1 })
  .toArray();
console.log(`Total 2026 statline dates: ${dates.length}`);

// For each date, check if this player has any entries
console.log(`\n=== Checking ${mlbId} in each 2026 statline date ===`);
let totalEntries = 0;
let totalPositions = [];

for (const doc of dates.slice(0, 20)) {  // Check first 20 dates
  const statlineDoc = await db.collection('statlines').findOne({ _id: doc._id });
  const playerMatches = Object.entries(statlineDoc.p || {})
    .filter(([key]) => key.startsWith(mlbId + '_'));
  
  if (playerMatches.length > 0) {
    console.log(`\n${doc._id}:`);
    playerMatches.forEach(([key, val]) => {
      const gameId = key.split('_')[1];
      const positions = val.pos || [];
      totalPositions.push(...positions);
      console.log(`  gameId ${gameId}: ${JSON.stringify(val)}`);
    });
    totalEntries += playerMatches.length;
  }
}

console.log(`\nTotal entries for ${mlbId}: ${totalEntries}`);
console.log(`All positions seen: ${totalPositions.join(', ')}`);
console.log(`Position breakdown:`, Object.fromEntries(
  [...new Set(totalPositions)].map(p => [p, totalPositions.filter(x => x === p).length])
));

// Check some raw statline documents structure for debugging
console.log(`\n=== Sample statline doc structure ===`);
const sample = await db.collection('statlines').findOne({ _id: /^2026-03/ });
if (sample) {
  const keys = Object.keys(sample.p || {}).slice(0, 3);
  console.log(`Sample p keys:`, keys);
  const exampleEntry = sample.p[keys[0]];
  console.log(`Example entry structure:`, exampleEntry);
}

await client.close();
