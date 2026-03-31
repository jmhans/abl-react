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

// Check positions collection
console.log('=== positions collection (sample 5) ===');
const pos = await db.collection('positions').find({}).limit(5).toArray();
console.log(JSON.stringify(pos, null, 2));
console.log('Total in positions:', await db.collection('positions').countDocuments());

// Manually trace the pipeline for a known player with 2025 data
// mlbId 666023 has C position in 2025
console.log('\n=== position_log for mlbId 666023 ===');
const pl = await db.collection('position_log').find({ mlbId: '666023' }).toArray();
console.log(JSON.stringify(pl, null, 2));

// player with mlbID 666023
console.log('\n=== player with mlbID 666023 ===');
const player = await db.collection('players').findOne({ mlbID: '666023' });
console.log(JSON.stringify({ _id: player?._id, name: player?.name, mlbID: player?.mlbID, eligible: player?.eligible, CommishPos: player?.CommishPos }));

// positions_view for same player
console.log('\n=== positions_view for mlbID 666023 ===');
const pvPlayer = await db.collection('positions_view').findOne({ mlbID: '666023' });
console.log(JSON.stringify(pvPlayer));

// Check positions_view with non-empty eligible
console.log('\n=== positions_view with non-empty eligible (sample 3) ===');
const pvNonEmpty = await db.collection('positions_view').find({ eligible: { $exists: true, $ne: [] } }).limit(3).toArray();
console.log(JSON.stringify(pvNonEmpty.map(p => ({ name: p.name, mlbID: p.mlbID, eligible: p.eligible })), null, 2));
console.log('Count with non-empty eligible:', await db.collection('positions_view').countDocuments({ eligible: { $exists: true, $ne: [] } }));

await client.close();
