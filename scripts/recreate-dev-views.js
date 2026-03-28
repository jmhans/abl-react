/**
 * recreate-dev-views.js
 *
 * The copy-prod-to-dev script materializes MongoDB views as static collections.
 * This script reads the view definitions from prod and recreates them in dev
 * as proper live views, dropping the stale static copies first.
 *
 * Usage:
 *   node scripts/recreate-dev-views.js
 */

const { MongoClient } = require('mongodb');
const fs   = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=\r]+)=(.*\S*)/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const PROD_DB = 'heroku_wm40bx9r';
const DEV_DB  = 'abl_dev';

async function main() {
  const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGODB_URI_DIRECT not set in .env.local');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB\n');

  try {
    const prodDb = client.db(PROD_DB);
    const devDb  = client.db(DEV_DB);

    const allCollInfos = await prodDb.listCollections().toArray();
    const views = allCollInfos.filter((c) => c.type === 'view');

    if (views.length === 0) {
      console.log('No views found in prod database.');
      return;
    }

    console.log(`Found ${views.length} view(s) in prod:\n`);

    for (const viewInfo of views) {
      const viewName = viewInfo.name;
      const viewOn   = viewInfo.options && viewInfo.options.viewOn;
      const pipeline = viewInfo.options && viewInfo.options.pipeline;

      if (!viewOn || !pipeline) {
        console.warn(`  ⚠ Skipping ${viewName} — missing viewOn or pipeline`);
        continue;
      }

      console.log(`  Recreating: ${viewName}  (on: ${viewOn}, stages: ${pipeline.length})`);

      // Drop stale copy in dev
      try {
        await devDb.dropCollection(viewName);
        console.log(`    ✓ Dropped existing dev copy`);
      } catch (err) {
        if (err.code === 26) {
          console.log(`    — ${viewName} did not exist in dev`);
        } else {
          throw err;
        }
      }

      // Recreate as a live view
      await devDb.createCollection(viewName, { viewOn, pipeline });
      console.log(`    ✓ Created view\n`);
    }

    console.log('✅ All views recreated in dev successfully.');
    console.log('\nNow run "Sync Roster Statuses" from the Admin page to populate mlbrosters,');
    console.log('then the draft board active-only filter will work correctly.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
