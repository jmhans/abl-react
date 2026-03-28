/**
 * migrate-results-to-singular.js
 *
 * Migrates the games collection from:
 *   { results: [ resultObj, ... ] }   (array, often with duplicates from recalcs)
 * to:
 *   { result: resultObj }              (single object — most recent / canonical)
 *
 * Also patches MongoDB views in dev that reference "$results" so they use the
 * new "$result" field (by wrapping it in a single-element array just before the
 * existing $unwind stage, keeping the rest of each view's pipeline unchanged).
 *
 * Usage:
 *   node scripts/migrate-results-to-singular.js             # dev only (safe)
 *   node scripts/migrate-results-to-singular.js --prod      # also migrate prod
 *   node scripts/migrate-results-to-singular.js --dryrun    # count only, no writes
 */

const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');

// Load .env.local
const ep = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(ep)) {
  for (const l of fs.readFileSync(ep, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([^#=\r]+)=(.*\S*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
const includeProd = process.argv.includes('--prod');
const dryRun = process.argv.includes('--dryrun');

const DEV_DB = 'abl_dev';
const PROD_DB = 'heroku_wm40bx9r';

async function migrateGames(db, dbName) {
  console.log(`\n=== Migrating games in ${dbName} ===`);

  // Count games still using the old array format
  const withArray = await db.collection('games').countDocuments({
    results: { $exists: true },
  });
  const withSingular = await db.collection('games').countDocuments({
    result: { $exists: true },
  });
  console.log(`  Games with old "results" array : ${withArray}`);
  console.log(`  Games already with "result"    : ${withSingular}`);

  if (withArray === 0) {
    console.log('  Nothing to migrate — skipping.');
    return;
  }

  if (dryRun) {
    console.log('  [dryrun] Would migrate', withArray, 'games.');
    return;
  }

  // Use bulk operations for speed
  const bulk = [];
  const cursor = db.collection('games').find({ results: { $exists: true } });

  let migrated = 0;
  let skipped = 0;

  for await (const game of cursor) {
    const resultsArr = Array.isArray(game.results) ? game.results : [game.results];
    // results[0] = most recent (new calcs pushed to front with $position:0)
    // Filter out nulls just in case
    const validResults = resultsArr.filter(Boolean);
    if (validResults.length === 0) {
      skipped++;
      continue;
    }
    const canonical = validResults[0];

    bulk.push({
      updateOne: {
        filter: { _id: game._id },
        update: {
          $set: { result: canonical },
          $unset: { results: '' },
        },
      },
    });
    migrated++;

    // Write in batches of 500
    if (bulk.length === 500) {
      await db.collection('games').bulkWrite(bulk, { ordered: false });
      bulk.length = 0;
      process.stdout.write('.');
    }
  }

  if (bulk.length > 0) {
    await db.collection('games').bulkWrite(bulk, { ordered: false });
  }

  console.log(`\n  ✓ Migrated: ${migrated}, Skipped (no valid results): ${skipped}`);
}

async function patchViews(db, dbName, prodDb) {
  console.log(`\n=== Patching views in ${dbName} ===`);

  // Strategy 1: wrap-before-unwind — for views that have $unwind "$results"
  // Strategy 2: field-ref replace — for views that reference "$results.X" directly without a $results unwind

  const sourcePipelines = new Map(); // view name → { viewOn, pipeline } from prod (original, unpatched)
  if (prodDb) {
    const prodViews = await prodDb.listCollections({ type: 'view' }).toArray();
    for (const v of prodViews) {
      sourcePipelines.set(v.name, { viewOn: v.options.viewOn, pipeline: v.options.pipeline });
    }
  }

  const views = await db.listCollections({ type: 'view' }).toArray();
  if (views.length === 0) {
    console.log('  No views found.');
    return;
  }

  for (const viewInfo of views) {
    const name = viewInfo.name;
    const pipeline = viewInfo.options?.pipeline;
    if (!Array.isArray(pipeline)) continue;

    const hasResultsUnwind = pipeline.some(
      (s) => s.$unwind?.path === '$results' || s.$unwind === '$results'
    );

    const pipelineStr = JSON.stringify(pipeline);
    const hasResultsDotRef = pipelineStr.includes('"$results.');

    if (!hasResultsUnwind && !hasResultsDotRef) continue; // nothing to patch

    // Prefer original prod pipeline to avoid double-patching
    const origSource = sourcePipelines.get(name);
    const sourcePipeline = origSource?.pipeline || pipeline;
    const sourceViewOn = origSource?.viewOn || viewInfo.options.viewOn;

    if (hasResultsUnwind) {
      // Check if already patched — look at both the source pipeline and the current view pipeline
      const isPatched = (p) =>
        Array.isArray(p) &&
        p.some((s) => s.$set?.results && JSON.stringify(s.$set.results) === JSON.stringify(['$result']));
      if (isPatched(sourcePipeline) || isPatched(pipeline)) {
        console.log(`  ${name}: already patched (wrap) — skipping`);
        continue;
      }

      const unwindIdx = sourcePipeline.findIndex(
        (s) => s.$unwind?.path === '$results' || s.$unwind === '$results'
      );
      const patchStages = [
        { $match: { result: { $exists: true, $ne: null } } },
        { $set: { results: ['$result'] } },
      ];
      const newPipeline = [
        ...sourcePipeline.slice(0, unwindIdx),
        ...patchStages,
        ...sourcePipeline.slice(unwindIdx),
      ];

      if (dryRun) {
        console.log(`  ${name}: [dryrun] would wrap-patch (before index ${unwindIdx})`);
        continue;
      }
      try {
        await db.dropCollection(name);
        await db.createCollection(name, { viewOn: sourceViewOn, pipeline: newPipeline });
        console.log(`  ✓ ${name}: wrap-patched`);
      } catch (err) {
        console.error(`  ✗ ${name}: FAILED —`, err.message);
      }
    } else if (hasResultsDotRef) {
      // Replace "$results." field references with "$result."
      const origStr = JSON.stringify(sourcePipeline);
      if (!origStr.includes('"$results.')) {
        console.log(`  ${name}: no "$results." field refs in source — skipping`);
        continue;
      }
      const newPipeline = JSON.parse(origStr.replace(/"\$results\./g, '"$result.'));

      if (dryRun) {
        const count = (origStr.match(/"\$results\./g) || []).length;
        console.log(`  ${name}: [dryrun] would replace ${count} "$results." refs`);
        continue;
      }
      try {
        await db.dropCollection(name);
        await db.createCollection(name, { viewOn: sourceViewOn, pipeline: newPipeline });
        console.log(`  ✓ ${name}: field-ref patched`);
      } catch (err) {
        console.error(`  ✗ ${name}: FAILED —`, err.message);
      }
    }
  }
}

async function main() {
  if (!uri) throw new Error('MONGODB_URI / MONGODB_URI_DIRECT not set in .env.local');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB');
  if (dryRun) console.log('[DRY RUN — no writes]');

  try {
    const devDb = client.db(DEV_DB);
    const prodDb = client.db(PROD_DB);

    await migrateGames(devDb, DEV_DB);
    await patchViews(devDb, DEV_DB, prodDb);

    if (includeProd) {
      await migrateGames(prodDb, PROD_DB);
      // For prod views, the current prod pipeline IS the canonical source (pass null)
      await patchViews(prodDb, PROD_DB, null);
    } else {
      console.log('\n💡 To also migrate prod, run with --prod flag.');
    }

    console.log('\n✅ Migration complete.');
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
