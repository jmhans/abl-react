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

console.log('Running ONE bulk write batch manually to debug...\n');

// Build a sample batch manually
const OF_POSITIONS = new Set(['RF', 'CF', 'LF']);
function normalizePos(pos) { return OF_POSITIONS.has(pos) ? 'OF' : pos; }
const EXCLUDED_FROM_ELIGIBLE = new Set(['PH', 'PR', 'P']);

const posLogOps = [];

// Get first 5 players
const matches = ['670329', '703178', '663624', '677008', '676679'];

for (const mlbId of matches) {
  posLogOps.push({
    updateOne: {
      filter: { mlbId, season: 2026 },
      update: {
        $set: {
          mlbId,
          season: 2026,
          maxPosition: 'TEST_FIX',
          eligiblePositions: ['TEST'],
          positionsLog: [{ pos: 'TEST', ct: 1 }],
        },
      },
      upsert: true,
    },
  });
}

console.log(`Executing ${posLogOps.length} updateOne operations...`);
const result = await db.collection('position_log').bulkWrite(posLogOps, { ordered: false });

console.log('\nBulkWrite result:');
console.log(`  matchedCount: ${result.matchedCount}`);
console.log(`  modifiedCount: ${result.modifiedCount}`);
console.log(`  upsertedCount: ${result.upsertedCount}`);
console.log(`  insertedCount: ${result.insertedCount}`);

// Verify one
const check = await db.collection('position_log').findOne({ mlbId: '670329', season: 2026 });
console.log(`\nCheck mlbId 670329 maxPosition: ${check.maxPosition}`);

// Revert all
await db.collection('position_log').deleteMany({
  mlbId: { $in: matches },
  season: 2026,
  maxPosition: 'TEST_FIX'
});

await db.collection('position_log').bulkWrite([
  {
    updateOne: {
      filter: { mlbId: '670329', season: 2026 },
      update: { $set: { maxPosition: 'DH', eligiblePositions: [], positionsLog: [] } },
      upsert: true,
    }
  }
]);

console.log('Reverted test changes');
await client.close();
