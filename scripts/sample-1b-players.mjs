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

// Sample a few to inspect
const sampleIds = ['467793', '502671', '596142'];

for (const mlbId of sampleIds) {
  console.log(`\n=== mlbId ${mlbId} ===`);
  const posLog = await db.collection('position_log').findOne({ mlbId, season: 2026 });
  console.log(JSON.stringify({
    mlbId: posLog?.mlbId,
    maxPosition: posLog?.maxPosition,
    positionsLog: posLog?.positionsLog,
    eligiblePositions: posLog?.eligiblePositions
  }, null, 2));

  // Check statlines for this player
  const hasStats = await db.collection('statlines')
    .countDocuments({
      _id: { $regex: `^2026-(?:0[1-3]|04-0[0-5])` },
      [`p.${mlbId}_`]: { $exists: true }
    });
  console.log(`Statline game appearances: ${hasStats}`);
}

await client.close();
