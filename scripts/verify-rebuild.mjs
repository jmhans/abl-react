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

console.log('=== PLAYER 656976 AFTER REBUILD ===\n');

const pos2026 = await db.collection('position_log').findOne({ mlbId: '656976', season: 2026 });

if (pos2026) {
  console.log('✅ 2026 entry found:');
  console.log(`   maxPosition: ${pos2026.maxPosition}`);
  console.log(`   eligiblePositions: ${JSON.stringify(pos2026.eligiblePositions)}`);
  console.log(`   positionsLog: ${JSON.stringify(pos2026.positionsLog)}`);
} else {
  console.log('❌ No 2026 entry (using 2025 fallback)');
  const pos2025 = await db.collection('position_log').findOne({ mlbId: '656976', season: 2025 });
  if (pos2025) {
    console.log(`   2025 fallback maxPosition: ${pos2025.maxPosition}`);
  }
}

// Show a few other players for comparison
console.log('\nSample of other players (first 5 with eligiblePositions):');
const samples = await db.collection('position_log')
  .find({ season: 2026, eligiblePositions: { $exists: true, $ne: [] } })
  .limit(5)
  .toArray();

samples.forEach(p => {
  console.log(`  ${p.mlbId}: max=${p.maxPosition}, eligible=${JSON.stringify(p.eligiblePositions)}, pos=${JSON.stringify(p.positionsLog.slice(0, 2))}`);
});

await client.close();
