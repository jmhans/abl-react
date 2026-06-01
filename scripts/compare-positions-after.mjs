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

// Load backup and compare sample
const backup = JSON.parse(readFileSync(resolve(__dirname, '..', 'position_log_2026_backup_PROD.json'), 'utf8'));

// Compare a few players
const testIds = ['656976', '681297', '624413'];

console.log('=== COMPARING BEFORE/AFTER ===\n');

for (const mlbId of testIds) {
  const before = backup.data.find(p => p.mlbId === mlbId);
  const after = await db.collection('position_log').findOne({ mlbId, season: 2026 });
  
  console.log(`mlbId ${mlbId}:`);
  console.log(`  BEFORE: maxPos=${before?.maxPosition}, topCount=${before?.positionsLog?.[0]?.ct}`);
  console.log(`  AFTER:  maxPos=${after?.maxPosition}, topCount=${after?.positionsLog?.[0]?.ct}`);
  console.log();
}

// Show overall distribution after
const allPos2026 = await db.collection('position_log')
  .find({ season: 2026 })
  .toArray();

const afterDist = {};
for (const entry of allPos2026) {
  const key = entry.maxPosition || 'unknown';
  afterDist[key] = (afterDist[key] || 0) + 1;
}

console.log(`\nTotal entries AFTER: ${allPos2026.length}`);
console.log('Position distribution AFTER:', JSON.stringify(afterDist, null, 2));

// Count suspicious after
let suspiciousAfter = 0;
for (const entry of allPos2026) {
  const topCount = entry.positionsLog?.[0]?.ct || 0;
  if (topCount >= 4) suspiciousAfter++;
}
console.log(`\nPlayers with suspicious counts (≥4) AFTER: ${suspiciousAfter}`);

await client.close();
