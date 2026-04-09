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

console.log(`=== After clearing stale 2026 positions ===\n`);

// Check position_log
console.log(`position_log for ${mlbId}:`);
const posLog = await db.collection('position_log').find({ mlbId }).toArray();
console.log(JSON.stringify(posLog.map(p => ({
  season: p.season,
  maxPosition: p.maxPosition,
  eligiblePositions: p.eligiblePositions
})), null, 2));

// Check players_view (should now fall back to 2025)
console.log(`\nplayers_view for ${mlbId}:`);
const pvPlayer = await db.collection('players_view').findOne({ mlbID: mlbId });
console.log(JSON.stringify({
  name: pvPlayer?.name,
  eligible: pvPlayer?.eligible,
  position: pvPlayer?.position,
  CommishPos: pvPlayer?.CommishPos
}, null, 2));

// Verify: player_view should now show 2025 eligibility since 2026 is cleared
console.log('\n✓ If eligible array shows positions from 2025, fallback is working correctly');

await client.close();
