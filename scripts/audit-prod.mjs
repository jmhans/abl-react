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

console.log('=== PROD POSITION_LOG AUDIT ===\n');

// Count total 2026 entries
const total2026 = await db.collection('position_log').countDocuments({ season: 2026 });
console.log(`Total 2026 position_log entries: ${total2026}`);

// Check if 656976 2026 entry exists and when it was last modified
const doc656976 = await db.collection('position_log').findOne({ mlbId: '656976', season: 2026 });
if (doc656976) {
  console.log(`\n656976 entry found:`);
  console.log(`  _id: ${doc656976._id}`);
  console.log(`  createdAt: ${doc656976.createdAt}`);
  console.log(`  updatedAt: ${doc656976.updatedAt}`);
  console.log(`  positions: ${JSON.stringify(doc656976.positionsLog)}`);
}

// Query how many DH entries exist in 2026
const dhCount = await db.collection('position_log').countDocuments({ 
  season: 2026, 
  'positionsLog.pos': 'DH' 
});
console.log(`\nDH entries in 2026: ${dhCount}`);

// Show sample 2026 entries
const samples = await db.collection('position_log')
  .find({ season: 2026 })
  .limit(3)
  .toArray();

console.log('\nSample 2026 entries (first 3):');
samples.forEach((s, i) => {
  console.log(`  ${i + 1}. mlbId=${s.mlbId}, max=${s.maxPosition}, pos=${JSON.stringify(s.positionsLog.slice(0, 2))}`);
});

await client.close();
