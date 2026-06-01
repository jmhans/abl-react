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

// Check if a direct update works
console.log('Testing direct update on one player...\n');

const testId = '656976';
const testUpdate = {
  updateOne: {
    filter: { mlbId: testId, season: 2026 },
    update: {
      $set: {
        mlbId: testId,
        season: 2026,
        maxPosition: 'DH_TEST',
        eligiblePositions: [],
        positionsLog: [{ pos: 'DH', ct: 2 }],
      },
    },
    upsert: true,
  },
};

const result = await db.collection('position_log').bulkWrite([testUpdate]);
console.log('Bulk write result:', result);

// Check if it was updated
const after = await db.collection('position_log').findOne({ mlbId: testId, season: 2026 });
console.log('\nAfter test update:');
console.log(JSON.stringify(after, null, 2));

// Revert it
await db.collection('position_log').updateOne(
  { mlbId: testId, season: 2026 },
  { $set: { maxPosition: '1B', positionsLog: [{ pos: '1B', ct: 4 }, { pos: 'DH', ct: 2 }] } }
);
console.log('✓ Reverted test change');

await client.close();
