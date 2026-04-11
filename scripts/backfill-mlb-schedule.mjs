/**
 * One-time (and repeatable) backfill: fetches MLB regular-season schedule for the
 * next 14 days from the Stats API and upserts into mlbgameschemas.
 *
 * Usage:
 *   node scripts/backfill-mlb-schedule.mjs           # dev DB
 *   node scripts/backfill-mlb-schedule.mjs --prod    # prod DB
 */
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const isProd = process.argv.includes('--prod');
const uri = isProd
  ? process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r')
  : process.env.MONGODB_URI;
const dbName = isProd ? 'heroku_wm40bx9r' : 'abl_dev';

const LOOKAHEAD_DAYS = 14;
const MLB_API = 'https://statsapi.mlb.com/api/v1';

const today = new Date();
const startDate = today.toISOString().slice(0, 10);
const endDate = new Date(today.getTime() + LOOKAHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);

console.log(`Fetching MLB schedule ${startDate} → ${endDate}  (${isProd ? 'PROD' : 'dev'})`);

const url =
  `${MLB_API}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&gameType=R`;

const resp = await fetch(url);
if (!resp.ok) throw new Error(`MLB Stats API ${resp.status}: ${resp.statusText}`);
const data = await resp.json();

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

// Ensure supporting index
await db.collection('mlbgameschemas').createIndex(
  { officialDate: 1, gameType: 1, gameDate: 1 },
  { background: true }
);
console.log('Index ensured: { officialDate, gameType, gameDate }');

const bulkOps = [];
for (const dateEntry of data.dates ?? []) {
  for (const game of dateEntry.games ?? []) {
    bulkOps.push({
      updateOne: {
        filter: { gamePk: game.gamePk },
        update: {
          $set: {
            gamePk: game.gamePk,
            gameDate: game.gameDate,
            officialDate: game.officialDate,
            gameType: game.gameType,
            season: game.season,
            status: game.status,
            teams: game.teams,
          },
        },
        upsert: true,
      },
    });
  }
}

if (bulkOps.length === 0) {
  console.log('No games found in the specified range.');
} else {
  const result = await db.collection('mlbgameschemas').bulkWrite(bulkOps, { ordered: false });
  console.log(`Done. Fetched: ${bulkOps.length}  Inserted: ${result.upsertedCount}  Updated: ${result.modifiedCount}`);
}

// Show the first 5 upserted dates as confirmation
const sample = await db.collection('mlbgameschemas')
  .find({ officialDate: { $gte: startDate }, gameType: 'R' })
  .sort({ gameDate: 1 })
  .limit(5)
  .toArray();
console.log('\nSample upcoming games:');
for (const g of sample) {
  console.log(`  ${g.officialDate}  ${g.gameDate}  startTimeTBD:${g.status?.startTimeTBD}`);
}

await client.close();
