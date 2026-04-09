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

// Get all 2026 position_log entries
console.log('Getting all 2026 position_log entries...');
const allPos2026 = await db.collection('position_log')
  .find({ season: 2026 })
  .project({ mlbId: 1 })
  .toArray();

console.log(`Found ${allPos2026.length} total position_log 2026 entries`);

// For each, check if they have game data through 2026-04-05
let toDelete = [];
let kept = [];

for (const doc of allPos2026) {
  const gameCount = await db.collection('statlines').countDocuments({
    _id: { $regex: `^2026-(?:0[1-3]|04-0[0-5])` },
    [`p.${doc.mlbId}_`]: { $exists: true }
  });
  
  if (gameCount === 0) {
    toDelete.push(doc.mlbId);
  } else {
    kept.push(doc.mlbId);
  }
}

console.log(`\n  With game appearances through 04-05: ${kept.length}`);
console.log(`  WITHOUT game appearances (will delete): ${toDelete.length}`);

if (toDelete.length > 0) {
  console.log(`\nDeleting position_log entries for ${toDelete.length} players with no 2026 game data...`);
  const result = await db.collection('position_log').deleteMany({
    season: 2026,
    mlbId: { $in: toDelete }
  });
  
  console.log(`✅ Deleted ${result.deletedCount} position_log 2026 entries`);
  console.log(`   These players will now fall back to 2025 eligibility via players_view`);
}

// Verify
const remainingCount = await db.collection('position_log').countDocuments({ season: 2026 });
console.log(`\nRemaining 2026 position_log entries: ${remainingCount} (should equal ${kept.length})`);

await client.close();
