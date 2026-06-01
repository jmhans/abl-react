/**
 * fix-prod-standings-view.cjs
 *
 * The PROD standings_view still reads from the old `results` (plural array) field.
 * The DEV pipeline was updated during the results→result migration to wrap
 * `result` (singular) into a temp array before unwinding. This script copies
 * the corrected pipeline from dev → prod for standings_view and advanced_standings_view.
 *
 * Usage:  node scripts/fix-prod-standings-view.cjs
 */
const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const baseUri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
const devUri  = baseUri;
const prodUri = baseUri.replace('abl_dev', 'heroku_wm40bx9r');

const VIEWS_TO_FIX = ['standings_view', 'advanced_standings_view'];

async function main() {
  const devClient  = new MongoClient(devUri);
  const prodClient = new MongoClient(prodUri);
  await Promise.all([devClient.connect(), prodClient.connect()]);
  const devDb  = devClient.db('abl_dev');
  const prodDb = prodClient.db('heroku_wm40bx9r');

  console.log('Connected to both databases.\n');

  // Safety check: refuse if prod URI is the same as dev
  if (devUri === prodUri) {
    throw new Error('devUri and prodUri are the same — cannot distinguish prod from dev.');
  }

  for (const viewName of VIEWS_TO_FIX) {
    console.log(`=== ${viewName} ===`);

    // Get current dev definition (the correct one)
    const devInfo = await devDb.listCollections({ name: viewName }).next();
    if (!devInfo) { console.log(`  ⚠ Not found in dev — skipping`); continue; }
    const { viewOn, pipeline } = devInfo.options;
    console.log(`  DEV: viewOn=${viewOn}, stages=${pipeline.length}`);

    // Show current prod definition
    const prodInfo = await prodDb.listCollections({ name: viewName }).next();
    if (prodInfo) {
      console.log(`  PROD current: viewOn=${prodInfo.options.viewOn}, stages=${prodInfo.options.pipeline.length}`);
    } else {
      console.log(`  PROD current: view does not exist`);
    }

    if (
      prodInfo &&
      JSON.stringify(prodInfo.options.pipeline) === JSON.stringify(pipeline) &&
      prodInfo.options.viewOn === viewOn
    ) {
      console.log(`  ✓ Already in sync — nothing to do\n`);
      continue;
    }

    // Drop existing prod view
    if (prodInfo) {
      await prodDb.dropCollection(viewName);
      console.log(`  ✓ Dropped existing prod view`);
    }

    // Recreate with dev pipeline
    await prodDb.createCollection(viewName, { viewOn, pipeline });
    console.log(`  ✓ Recreated with ${pipeline.length}-stage dev pipeline`);

    // Quick sanity check
    const count = await prodDb.collection(viewName).countDocuments();
    console.log(`  ✓ Sanity check: ${count} docs returned from prod view\n`);
  }

  await devClient.close();
  await prodClient.close();
  console.log('Done.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
