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
const db = client.db('abl_dev');

// What seasons exist in position_log?
const seasons = await db.collection('position_log').distinct('season');
console.log('position_log seasons:', seasons.sort());

// Sample 2025 position_log entries
console.log('\n=== position_log 2025 (sample 5) ===');
const pl2025 = await db.collection('position_log').find({ season: 2025 }).limit(5).toArray();
console.log(JSON.stringify(pl2025, null, 2));

console.log('\nTotal position_log 2025 records:', await db.collection('position_log').countDocuments({ season: 2025 }));
console.log('Total position_log 2024 records:', await db.collection('position_log').countDocuments({ season: 2024 }));

// Check how positions_view is defined (it's a view)
const colInfo = await db.listCollections({ name: 'positions_view' }).toArray();
console.log('\n=== positions_view definition ===');
console.log(JSON.stringify(colInfo, null, 2));

// Check player with mlbID to match position_log mlbId
console.log('\n=== player with mlbID sample ===');
const ps = await db.collection('players').find({ mlbID: { $exists: true, $ne: '' } }).limit(3).project({ name: 1, mlbID: 1, eligible: 1, position: 1, CommishPos: 1 }).toArray();
console.log(JSON.stringify(ps, null, 2));

await client.close();
