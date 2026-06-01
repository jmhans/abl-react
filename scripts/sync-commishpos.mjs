import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

console.log('🔴 SYNCING positions.CommishPos FROM position_log 2026 maxPosition\n');

// Get all 2026 position_log entries
const posLog2026 = await db.collection('position_log')
  .find({ season: 2026 })
  .toArray();

console.log(`Found ${posLog2026.length} position_log 2026 entries`);

const positionOps = [];

for (const logEntry of posLog2026) {
  positionOps.push({
    updateOne: {
      filter: { mlbId: logEntry.mlbId },
      update: {
        $set: { CommishPos: logEntry.maxPosition },
      },
      upsert: false,
    },
  });
}

console.log(`Updating ${positionOps.length} positions docs...\n`);

const BATCH = 500;
let totalUpdated = 0;

for (let i = 0; i < positionOps.length; i += BATCH) {
  try {
    const r = await db.collection('positions').bulkWrite(positionOps.slice(i, i + BATCH), { ordered: false });
    const batch = `batch ${Math.floor(i / BATCH) + 1}`;
    console.log(`  ${batch}: matched=${r.matchedCount}, modified=${r.modifiedCount}`);
    totalUpdated += r.modifiedCount;
  } catch (err) {
    console.error(`ERROR in batch: ${err.message}`);
  }
}

console.log(`\n✅ Updated ${totalUpdated} positions.CommishPos fields`);

await client.close();
