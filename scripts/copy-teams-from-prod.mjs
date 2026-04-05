#!/usr/bin/env node

/**
 * Upsert all teams from production database to development database.
 * Teams are global objects referenced by league-seasons, not tied to any specific season.
 * Usage: node scripts/copy-teams-from-prod.mjs
 */

import { MongoClient } from 'mongodb';
import process from 'process';

const DEV_MONGODB_URL = process.env.MONGODB_DB_URL || 'mongodb://localhost:27017';
const DEV_DB_NAME = process.env.MONGODB_DB || 'abl_dev';

const PROD_MONGODB_URL = process.env.PROD_MONGODB_URL;
const PROD_DB_NAME = process.env.PROD_MONGODB_DB || 'heroku_wm40bx9r';

async function main() {
  if (!PROD_MONGODB_URL) {
    console.error('Error: PROD_MONGODB_URL environment variable not set');
    process.exit(1);
  }

  const prodClient = new MongoClient(PROD_MONGODB_URL);
  const devClient = new MongoClient(DEV_MONGODB_URL);

  try {
    console.log(`\nCopying all teams from prod to dev (upsert)...`);

    await prodClient.connect();
    const prodDb = prodClient.db(PROD_DB_NAME);

    await devClient.connect();
    const devDb = devClient.db(DEV_DB_NAME);

    // Get all teams from prod
    const prodTeams = await prodDb.collection('ablteams').find({}).toArray();
    console.log(`Found ${prodTeams.length} teams in prod`);

    if (prodTeams.length === 0) {
      console.error('No teams found in prod');
      process.exit(1);
    }

    // Upsert each team into dev
    let upserted = 0;
    for (const team of prodTeams) {
      const result = await devDb.collection('ablteams').updateOne(
        { _id: team._id },
        { $set: team },
        { upsert: true }
      );
      if (result.upsertedCount > 0) {
        upserted++;
      }
    }

    console.log(`\n✓ Upserted ${prodTeams.length} teams`);
    console.log(`  - ${upserted} new teams inserted`);
    console.log(`  - ${prodTeams.length - upserted} teams updated`);

    console.log('\n✅ Teams synchronized successfully');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await prodClient.close();
    await devClient.close();
  }
}

main();
