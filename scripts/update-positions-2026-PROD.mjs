import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

// Connect to PROD
const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

const SEASON_YEAR = 2026;
const GAMES_FOR_ELIGIBLE = 10;
const EXCLUDED_FROM_ELIGIBLE = new Set(['PH', 'PR', 'P']);
const OF_POSITIONS = new Set(['RF', 'CF', 'LF']);
function normalizePos(pos) { return OF_POSITIONS.has(pos) ? 'OF' : pos; }

console.log('🔴 UPDATING PROD DATABASE: heroku_wm40bx9r');
console.log('Scanning 2026 statlines through 2026-04-05...\n');

const statDates2026 = await db.collection('statlines')
  .find({ _id: { $regex: `^2026-(?:0[1-3]|04-0[0-5])` } })
  .toArray();

console.log(`Found ${statDates2026.length} 2026 statline date documents (through 2026-04-05)`);

if (statDates2026.length === 0) {
  console.log('⚠️  No 2026 statlines found.');
  await client.close();
  process.exit(1);
}

const playerPosCounts = {};

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
  }
}

console.log(`Players with 2026 appearances: ${Object.keys(playerPosCounts).length}`);

const positionsOps = [];
const posLogOps = [];

for (const [mlbId, posCounts] of Object.entries(playerPosCounts)) {
  const sorted = Object.entries(posCounts).sort((a, b) => b[1] - a[1]);
  const maxPos = sorted[0]?.[0] ?? 'DH';
  const eligiblePositions = sorted
    .filter(([pos, ct]) => ct >= GAMES_FOR_ELIGIBLE && !EXCLUDED_FROM_ELIGIBLE.has(pos))
    .map(([pos]) => pos);
  const positionsLog = sorted.map(([pos, ct]) => ({ pos, ct }));

  positionsOps.push({
    updateOne: {
      filter: { mlbId },
      update: { $set: { mlbId, CommishPos: maxPos } },
      upsert: true,
    },
  });

  posLogOps.push({
    updateOne: {
      filter: { mlbId, season: SEASON_YEAR },
      update: {
        $set: {
          mlbId,
          season: SEASON_YEAR,
          maxPosition: maxPos,
          eligiblePositions,
          positionsLog,
        },
      },
      upsert: true,
    },
  });
}

console.log(`\nClearing existing 2026 position_log to start fresh...`);
const deleteResult = await db.collection('position_log').deleteMany({ season: 2026 });
console.log(`  Deleted ${deleteResult.deletedCount} stale 2026 entries\n`);

// Apply in batches
const BATCH = 500;
let positionsUpserted = 0;
let posLogUpserted = 0;

console.log(`Applying ${positionsOps.length} positions ops in batches of ${BATCH}...`);
for (let i = 0; i < positionsOps.length; i += BATCH) {
  try {
    const r = await db.collection('positions').bulkWrite(positionsOps.slice(i, i + BATCH), { ordered: false });
    const batch = `positions batch ${Math.floor(i / BATCH) + 1}`;
    console.log(`  ${batch}: matched=${r.matchedCount}, modified=${r.modifiedCount}, upserted=${r.upsertedCount}`);
    positionsUpserted += r.upsertedCount + r.modifiedCount;
  } catch (err) {
    console.error(`ERROR in positions batch: ${err.message}`);
  }
}

console.log(`\nApplying ${posLogOps.length} position_log ops in batches of ${BATCH}...`);
for (let i = 0; i < posLogOps.length; i += BATCH) {
  try {
    const r = await db.collection('position_log').bulkWrite(posLogOps.slice(i, i + BATCH), { ordered: false });
    const batch = `pos_log batch ${Math.floor(i / BATCH) + 1}`;
    console.log(`  ${batch}: matched=${r.matchedCount}, modified=${r.modifiedCount}, upserted=${r.upsertedCount}`);
    posLogUpserted += r.upsertedCount + r.modifiedCount;
  } catch (err) {
    console.error(`ERROR in position_log batch: ${err.message}`);
  }
}

console.log(`\n✅ positions (CommishPos) upserted: ${positionsUpserted}`);
console.log(`✅ position_log 2026 upserted/updated: ${posLogUpserted}`);

await client.close();
console.log('\n✅ PROD update complete');
