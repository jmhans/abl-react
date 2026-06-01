import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

console.log('=== CHECKING WHY 2 PLAYERS DIDN\'T UPDATE ===\n');

const failedIds = ['642207', '678218'];

for (const mlbId of failedIds) {
  const posLog = await db.collection('position_log').findOne({ mlbId, season: 2026 });
  const positions = await db.collection('positions').findOne({ mlbId });
  const player = await db.collection('players').findOne({ mlbID: mlbId });
  
  console.log(`${mlbId} (${player?.name || 'Unknown'}):`);
  console.log(`  position_log 2026: ${posLog ? posLog.maxPosition : 'NOT FOUND'}`);
  console.log(`  positions doc: ${positions ? 'EXISTS' : 'DOES NOT EXIST'}`);
  if (positions) {
    console.log(`    CommishPos: ${positions.CommishPos || 'undefined'}`);
  }
  console.log();
}

// Try to create/upsert them if needed
console.log('Creating/updating positions docs for missing players...\n');

const ops = [
  { mlbId: '642207', CommishPos: 'DH' },
  { mlbId: '678218', CommishPos: 'C' },
].map(p => ({
  updateOne: {
    filter: { mlbId: p.mlbId },
    update: { $set: { mlbId: p.mlbId, CommishPos: p.CommishPos } },
    upsert: true,
  },
}));

const r = await db.collection('positions').bulkWrite(ops);
console.log(`Upserted: ${r.upsertedCount}, Modified: ${r.modifiedCount}`);

await client.close();
