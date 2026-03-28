/**
 * patch-advanced-standings-views.js
 *
 * Fixes AdvancedStandings and advanced_standings_view after the results→result migration.
 * These views reference "$results.scores" directly (without $unwind of $results),
 * so the generic patch in migrate-results-to-singular.js didn't catch them.
 *
 * Usage: node scripts/patch-advanced-standings-views.js
 */
const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
const ep = path.resolve(__dirname, '..', '.env.local');
for (const l of fs.readFileSync(ep, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;

function patchPipeline(pipeline) {
  return pipeline.map(stage => {
    // Deep-replace "$results.X" → "$result.X" and "$$results.X" → "$$result.X" in all stage values
    return JSON.parse(
      JSON.stringify(stage).replace(/"\$results\./g, '"$result.')
    );
  });
}

async function patchView(db, viewName) {
  const views = await db.listCollections({ name: viewName }).toArray();
  const viewInfo = views[0];
  if (!viewInfo) {
    console.log(`  ${viewName}: NOT FOUND — skipping`);
    return;
  }

  const original = JSON.stringify(viewInfo.options.pipeline);
  const patched = patchPipeline(viewInfo.options.pipeline);
  const patchedStr = JSON.stringify(patched);

  if (original === patchedStr) {
    console.log(`  ${viewName}: no "$results." references — nothing to change`);
    return;
  }

  // Count replacements
  const count = (original.match(/"\$results\./g) || []).length;
  console.log(`  ${viewName}: replacing ${count} "$results." → "$result." reference(s)...`);

  await db.dropCollection(viewName);
  await db.createCollection(viewName, {
    viewOn: viewInfo.options.viewOn,
    pipeline: patched,
  });
  console.log(`  ✓ ${viewName}: patched`);

  // Verify it now returns results
  const sample = await db.collection(viewName).findOne({});
  console.log(`    → now returns docs: ${sample !== null}`);
}

async function main() {
  if (!uri) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected\n');

  const db = client.db('abl_dev');

  // Patch all dev views that have "$results." references
  console.log('=== Patching views with "$results." field references ===');
  const allViews = await db.listCollections({ type: 'view' }).toArray();
  for (const v of allViews) {
    const pipelineStr = JSON.stringify(v.options?.pipeline || []);
    if (pipelineStr.includes('"$results.')) {
      await patchView(db, v.name);
    }
  }

  // Verify final counts
  console.log('\n=== Verification ===');
  const viewsToCheck = ['AdvancedStandings', 'advanced_standings_view', 'StandingsHelper', 'standings_view', 'Standings'];
  for (const name of viewsToCheck) {
    try {
      const count = await db.collection(name).countDocuments();
      console.log(`  ${name}: ${count} docs`);
    } catch (e) {
      console.log(`  ${name}: ERROR — ${e.message}`);
    }
  }

  await client.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
