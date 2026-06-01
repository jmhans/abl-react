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

console.log('Aggregating positions from 2026 statlines (through 04-05) in PROD...\n');

const OF_POSITIONS = new Set(['RF', 'CF', 'LF']);
function normalizePos(pos) { return OF_POSITIONS.has(pos) ? 'OF' : pos; }
const EXCLUDED_FROM_ELIGIBLE = new Set(['PH', 'PR', 'P']);

const statDates2026 = await db.collection('statlines')
  .find({ _id: { $regex: `^2026-(?:0[1-3]|04-0[0-5])` } })
  .toArray();

console.log(`Found ${statDates2026.length} statline dates\n`);

const playerPosCounts = {};
let totalGameEntries = 0;

for (const doc of statDates2026) {
  const entries = doc.p || {};
  for (const [key, val] of Object.entries(entries)) {
    const mlbId = key.split('_')[0];
    const rawPositions = val.pos || [];
    if (!playerPosCounts[mlbId]) playerPosCounts[mlbId] = {};
    const normalizedPositions = [...new Set(rawPositions.map(normalizePos))];
    for (const pos of normalizedPositions) {
      if (!EXCLUDED_FROM_ELIGIBLE.has(pos)) {
        playerPosCounts[mlbId][pos] = (playerPosCounts[mlbId][pos] || 0) + 1;
      }
    }
    totalGameEntries++;
  }
}

console.log(`Total game entries: ${totalGameEntries}`);
console.log(`Unique players: ${Object.keys(playerPosCounts).length}`);

// Sample a few
const samples = Object.entries(playerPosCounts).slice(0, 5);
console.log('\nSample players and their positions:');
samples.forEach(([id, pos]) => {
  console.log(`  ${id}: ${JSON.stringify(pos)}`);
});

// Compare with existing position_log
const existing = await db.collection('position_log').countDocuments({ season: 2026 });
console.log(`\nExisting position_log 2026 entries: ${existing}`);

await client.close();
