/**
 * update-positions-2026.mjs
 *
 * Run this AFTER 2026 statlines have been loaded into the `statlines` collection.
 *
 * It does three things:
 *   1. Aggregates position appearances from 2026 statlines for every player
 *   2. Updates the `positions` collection with CommishPos = most-played 2026 position
 *      (only for players who have appeared in at least 1 game in 2026)
 *   3. Upserts 2026 records into `position_log` with eligiblePositions (≥10 games)
 *      and maxPosition — the players_view will pick these up automatically.
 *
 * Positions excluded from eligibility (used for CommishPos but not fantasy slots):
 *   PH, PR, DH (per ABL rules - adjust EXCLUDED_FROM_ELIGIBLE as needed)
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const SEASON_YEAR = 2026;
const GAMES_FOR_ELIGIBLE = 10;  // games needed at a position to earn eligibility
const EXCLUDED_FROM_ELIGIBLE = new Set(['PH', 'PR']); // these can be CommishPos but not eligibility slots

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('abl_dev');

// 1. Aggregate positions from 2026 statlines
//    statlines docs: _id = "YYYY-MM-DD", p: { "{mlbId}_{gameId}": { pos: ["3B","2B"], ... } }
console.log('Scanning 2026 statlines...');
const statDates2026 = await db.collection('statlines')
  .find({ _id: { $regex: `^${SEASON_YEAR}-` } })
  .toArray();

console.log(`Found ${statDates2026.length} 2026 statline date documents`);

if (statDates2026.length === 0) {
  console.log('⚠️  No 2026 statlines found. Clearing all CommishPos (positions collection).');
  await db.collection('positions').deleteMany({});
  console.log('Done. Run this script again once 2026 game data is loaded.');
  await client.close();
  process.exit(0);
}

// Build a map: mlbId → { positionName → count }
const playerPosCounts = {};

for (const doc of statDates2026) {
  const entries = doc.p || {};
  for (const [key, val] of Object.entries(entries)) {
    const mlbId = key.split('_')[0];
    const positions = val.pos || [];
    if (!playerPosCounts[mlbId]) playerPosCounts[mlbId] = {};
    for (const pos of positions) {
      if (!EXCLUDED_FROM_ELIGIBLE.has(pos)) {
        playerPosCounts[mlbId][pos] = (playerPosCounts[mlbId][pos] || 0) + 1;
      }
    }
  }
}

console.log(`Players with 2026 appearances: ${Object.keys(playerPosCounts).length}`);

// 2. Build CommishPos and position_log entries
const positionsUpserts = [];
const posLogUpserts = [];

for (const [mlbId, posCounts] of Object.entries(playerPosCounts)) {
  // Sort positions by count desc
  const sorted = Object.entries(posCounts).sort((a, b) => b[1] - a[1]);
  const maxPos = sorted[0]?.[0] ?? null;
  const eligiblePositions = sorted
    .filter(([pos, ct]) => ct >= GAMES_FOR_ELIGIBLE && !EXCLUDED_FROM_ELIGIBLE.has(pos))
    .map(([pos]) => pos);
  const positionsLog = sorted.map(([pos, ct]) => ({ pos, ct }));

  if (maxPos) {
    positionsUpserts.push({
      updateOne: {
        filter: { mlbId },
        update: { $set: { mlbId, CommishPos: maxPos } },
        upsert: true,
      },
    });
  }

  posLogUpserts.push({
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

// 3. Also clear CommishPos for players with NO 2026 appearances
await db.collection('positions').deleteMany({
  mlbId: { $nin: Object.keys(playerPosCounts) },
});

// Apply in batches
const BATCH = 500;
let posInserted = 0, posLogInserted = 0;

for (let i = 0; i < positionsUpserts.length; i += BATCH) {
  const r = await db.collection('positions').bulkWrite(positionsUpserts.slice(i, i + BATCH));
  posInserted += r.upsertedCount + r.modifiedCount;
}

for (let i = 0; i < posLogUpserts.length; i += BATCH) {
  const r = await db.collection('position_log').bulkWrite(posLogUpserts.slice(i, i + BATCH));
  posLogInserted += r.upsertedCount + r.modifiedCount;
}

console.log(`✅ positions (CommishPos) upserted: ${posInserted}`);
console.log(`✅ position_log 2026 upserted/updated: ${posLogInserted}`);
console.log('players_view will now reflect 2026 eligibility automatically.');

await client.close();
