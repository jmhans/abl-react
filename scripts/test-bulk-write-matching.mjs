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

// Test matching
console.log('Testing filter matching...\n');

// Get first 5 players with 2026 entries
const existing = await db.collection('position_log')
  .find({ season: 2026 })
  .limit(5)
  .toArray();

console.log(`Found ${existing.length} existing 2026 entries to test against`);

for (const doc of existing) {
  // Try to find it with the same filter the update script uses
  const match = await db.collection('position_log').findOne({
    mlbId: doc.mlbId,
    season: 2026
  });
  console.log(`  mlbId ${doc.mlbId}: ${match ? '✓ matches' : '✗ NO MATCH'}`);
}

// Try bulk write for just one - log the result
const testOp = [{
  updateOne: {
    filter: { mlbId: existing[0].mlbId, season: 2026 },
    update: {
      $set: {
        mlbId: existing[0].mlbId,
        season: 2026,
        maxPosition: 'TEST_' + existing[0].maxPosition,
        eligiblePositions: [],
        positionsLog: [{ pos: 'TEST', ct: 99 }],
      },
    },
    upsert: true,
  },
}];

console.log(`\nTesting bulkWrite for mlbId ${existing[0].mlbId}...`);
const result = await db.collection('position_log').bulkWrite(testOp);
console.log('BulkWrite result:', {
  matchedCount: result.matchedCount,
  modifiedCount: result.modifiedCount,
  upsertedCount: result.upsertedCount
});

// Verify
const after = await db.collection('position_log').findOne({ mlbId: existing[0].mlbId, season: 2026 });
console.log(`maxPosition is now: ${after.maxPosition}`);

// Revert
await db.collection('position_log').updateOne(
  { mlbId: existing[0].mlbId, season: 2026 },
  { $set: { maxPosition: existing[0].maxPosition, positionsLog: existing[0].positionsLog } }
);

await client.close();
