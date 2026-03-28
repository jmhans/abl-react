/**
 * recreate-dev-views.ts
 *
 * The copy-prod-to-dev script copies MongoDB views as static collections
 * (because listCollections returns views, and find().toArray() on a view
 * executes the pipeline and returns a snapshot).
 *
 * This script reads the view definitions from prod and recreates them in dev
 * as proper MongoDB views, dropping the stale static copies first.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/recreate-dev-views.ts
 */

import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually (dotenv may not be installed at script level)
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const PROD_DB = 'heroku_wm40bx9r';
const DEV_DB  = 'abl_dev';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env.local');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB\n');

  try {
    const prodDb = client.db(PROD_DB);
    const devDb  = client.db(DEV_DB);

    // listCollections with no filter returns both collections AND views.
    // Views have type === 'view' and carry options.viewOn + options.pipeline.
    const allCollInfos = await prodDb.listCollections().toArray();
    const views = allCollInfos.filter((c) => c.type === 'view');

    if (views.length === 0) {
      console.log('No views found in prod database.');
      return;
    }

    console.log(`Found ${views.length} view(s) in prod:\n`);

    for (const viewInfo of views) {
      const viewName  = viewInfo.name;
      const viewOn    = (viewInfo as any).options?.viewOn as string | undefined;
      const pipeline  = (viewInfo as any).options?.pipeline as any[] | undefined;

      if (!viewOn || !pipeline) {
        console.warn(`  ⚠ Skipping ${viewName} — missing viewOn or pipeline in metadata`);
        continue;
      }

      console.log(`  Recreating view: ${viewName} (on: ${viewOn}, stages: ${pipeline.length})`);

      // Drop the stale static copy in dev (may be a collection OR an old view)
      try {
        await devDb.dropCollection(viewName);
        console.log(`    ✓ Dropped existing dev copy of ${viewName}`);
      } catch (err: any) {
        if (err.code === 26) {
          console.log(`    — ${viewName} did not exist in dev, nothing to drop`);
        } else {
          throw err;
        }
      }

      // Recreate as a proper view in dev
      await devDb.createCollection(viewName, { viewOn, pipeline });
      console.log(`    ✓ Created view ${viewName} on ${viewOn} with ${pipeline.length} pipeline stages\n`);
    }

    console.log('✅ All views recreated in dev successfully.');
    console.log('\nNote: views are now live — their data reflects the current dev collections.');
    console.log('If you need fresh base data, run copy-prod-to-dev first, then this script.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
