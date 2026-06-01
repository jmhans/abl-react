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

console.log('=== CURRENT PROD STATE AFTER UPDATE ===\n');

const posLog = await db.collection('position_log').findOne({ mlbId: '656976', season: 2026 });

if (!posLog) {
  console.log('position_log for 656976 season 2026: NOT FOUND (will use 2025 fallback)');
  
  // Show 2025 fallback
  const pos2025 = await db.collection('position_log').findOne({ mlbId: '656976', season: 2025 });
  console.log('\n2025 fallback positions:');
  console.log(`  maxPosition: ${pos2025?.maxPosition}`);
  console.log(`  eligible: ${JSON.stringify(pos2025?.eligiblePositions)}`);
} else {
  console.log('position_log for 656976 season 2026:');
  console.log(JSON.stringify({
    maxPosition: posLog.maxPosition,
    eligible: posLog.eligiblePositions,
    positions: posLog.positionsLog
  }, null, 2));
}

await client.close();
