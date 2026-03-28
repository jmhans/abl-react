#!/usr/bin/env node
/**
 * Seed ABML league + 2026 season into both dev and prod MongoDB databases.
 * Run: node scripts/seed-abml.js [--dryrun]
 */

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.resolve('.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r\n|\n/)) {
  const m = line.match(/^([^#=\r\s]+)\s*=\s*(.*\S*)/);
  if (m) process.env[m[1]] = m[2];
}

const DRY_RUN = process.argv.includes('--dryrun');

// Stable IDs for ABML
const ABML_LEAGUE_ID = new ObjectId('cccccc000000000000000002');
const ABML_SEASON_2026_ID = new ObjectId('dddddd000000000000002026');

const DATABASES = [
  { label: 'abl_dev', uri: process.env.MONGODB_URI, dbName: 'abl_dev' },
  { label: 'heroku_wm40bx9r', uri: process.env.MONGODB_URI_PROD, dbName: 'heroku_wm40bx9r' },
].filter((d) => d.uri);

async function seedDb(uri, dbName) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log(`\n=== ${dbName} ===`);

  // --- League upsert ---
  const leagueDoc = {
    _id: ABML_LEAGUE_ID,
    name: 'ABML',
    slug: 'abml',
    description: 'ABL Minor League',
    createdAt: new Date(),
  };

  if (DRY_RUN) {
    console.log('  [dryrun] Would upsert league: abml');
  } else {
    await db.collection('leagues').updateOne(
      { _id: ABML_LEAGUE_ID },
      { $setOnInsert: leagueDoc },
      { upsert: true }
    );
    console.log('  ✓ league: upserted ABML');
  }

  // --- Season upsert ---
  const seasonDoc = {
    _id: ABML_SEASON_2026_ID,
    leagueId: ABML_LEAGUE_ID,
    year: 2026,
    slug: '2026',
    status: 'active',
    isActive: true,
    teamIds: [],
    createdAt: new Date(),
  };

  if (DRY_RUN) {
    console.log('  [dryrun] Would upsert season: 2026');
  } else {
    await db.collection('seasons').updateOne(
      { _id: ABML_SEASON_2026_ID },
      { $setOnInsert: seasonDoc },
      { upsert: true }
    );
    console.log('  ✓ season: upserted 2026');
  }

  const existingLeague = await db.collection('leagues').findOne({ slug: 'abml' });
  const existingSeasons = await db.collection('seasons').find({ leagueId: ABML_LEAGUE_ID }).toArray();
  console.log(
    `  State: league=${existingLeague ? 'exists' : 'missing'}, seasons=${existingSeasons.length}`
  );

  await client.close();
}

(async () => {
  if (DRY_RUN) console.log('[DRY RUN — no writes]\n');

  for (const { label, uri, dbName } of DATABASES) {
    try {
      const client = new MongoClient(uri);
      await client.connect();
      await client.close();
      await seedDb(uri, dbName);
    } catch (err) {
      console.error(`  Error on ${label}:`, err.message);
    }
  }

  console.log('\n✅ Done.');
  console.log('\nJoin link (once deployed): /join/abml');
})();
