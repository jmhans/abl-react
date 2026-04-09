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

// 1. Check position_log for this player
console.log(`\n=== position_log for mlbId ${mlbId} ===`);
const posLog = await db.collection('position_log').find({ mlbId }).toArray();
console.log(JSON.stringify(posLog, null, 2));

// 2. Check player doc
console.log(`\n=== player doc with mlbID ${mlbId} ===`);
const player = await db.collection('players').findOne({ mlbID: mlbId });
console.log(JSON.stringify({
  name: player?.name,
  mlbID: player?.mlbID,
  eligible: player?.eligible,
  CommishPos: player?.CommishPos,
  position: player?.position
}, null, 2));

// 3. Check positions_view for this player
console.log(`\n=== positions_view for mlbID ${mlbId} ===`);
const posView = await db.collection('positions_view').findOne({ mlbID: mlbId });
console.log(JSON.stringify(posView, null, 2));

// 4. Check statlines with position data for this player (2026)
console.log(`\n=== statlines with positions for mlbId ${mlbId} (2026) ===`);
const statlines = await db.collection('statlines')
  .find({ _id: /^2026-/, [`p.${mlbId}_`]: { $exists: true } })
  .project({ _id: 1, [`p.${mlbId}_`]: 1 })
  .toArray();
console.log(`Found ${statlines.length} statline dates with ${mlbId} at a position`);
statlines.forEach(doc => {
  const entries = Object.entries(doc.p || {})
    .filter(([key]) => key.startsWith(mlbId + '_'));
  entries.forEach(([key, val]) => {
    console.log(`  ${doc._id}: gameId=${key.split('_')[1]}, positions=${val.pos}`);
  });
});

// 5. Look for spring training statlines
console.log(`\n=== spring training statlines for mlbId ${mlbId} ===`);
const spring = await db.collection('statlines')
  .find({ _id: /^2026-03/, [`p.${mlbId}_`]: { $exists: true } })
  .project({ _id: 1, [`p.${mlbId}_`]: 1 })
  .toArray();
console.log(`Found ${spring.length} spring training dates`);
spring.forEach(doc => {
  const entries = Object.entries(doc.p || {})
    .filter(([key]) => key.startsWith(mlbId + '_'));
  entries.forEach(([key, val]) => {
    console.log(`  ${doc._id}: ${key} = ${JSON.stringify(val)}`);
  });
});

await client.close();
