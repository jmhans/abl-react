/**
 * fix-all-standings-views.js
 *
 * Two-pronged fix:
 *
 * 1) Views that use $unwind "$results" (StandingsHelper, Standings, standings_view, etc.):
 *    - Restore from PROD (original pipeline)
 *    - Inject "$match result exists" + "$set { results: ['$result'] }" before the $unwind
 *    - Do NOT touch any post-unwind "$results." field references
 *
 * 2) Views that reference "$results.scores" directly without a $results unwind
 *    (AdvancedStandings, advanced_standings_view):
 *    - Restore from PROD (original pipeline)
 *    - Replace all "$results." field references with "$result."
 *
 * Usage: node scripts/fix-all-standings-views.js
 */
const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
const ep = path.resolve(__dirname, '..', '.env.local');
for (const l of fs.readFileSync(ep, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
const DEV_DB = 'abl_dev';
const PROD_DB = 'heroku_wm40bx9r';

// Strategy 1: wrap-before-unwind (for views that do $unwind "$results")
function applyWrapBeforeUnwindPatch(pipeline) {
  const unwindIdx = pipeline.findIndex(
    s => s.$unwind?.path === '$results' || s.$unwind === '$results'
  );
  if (unwindIdx === -1) return null; // not applicable

  const patchStages = [
    { $match: { result: { $exists: true, $ne: null } } },
    { $set: { results: ['$result'] } },
  ];
  return [
    ...pipeline.slice(0, unwindIdx),
    ...patchStages,
    ...pipeline.slice(unwindIdx),
  ];
}

// Strategy 2: replace "$results.X" → "$result.X" in field refs (for views that access results.scores directly)
function applyFieldRefReplacePatch(pipeline) {
  const str = JSON.stringify(pipeline);
  if (!str.includes('"$results.')) return null; // nothing to change
  return JSON.parse(str.replace(/"\$results\./g, '"$result.'));
}

async function fixView(prodDb, devDb, viewName, strategy) {
  // Get original pipeline from PROD
  const prodViews = await prodDb.listCollections({ name: viewName }).toArray();
  if (!prodViews[0]) {
    console.log(`  ${viewName}: NOT in prod — skipping`);
    return;
  }
  const { viewOn, pipeline: origPipeline } = prodViews[0].options;

  let newPipeline;
  if (strategy === 'wrap') {
    newPipeline = applyWrapBeforeUnwindPatch(origPipeline);
    if (!newPipeline) {
      console.log(`  ${viewName}: no $unwind "$results" found — skipping`);
      return;
    }
  } else if (strategy === 'replace') {
    newPipeline = applyFieldRefReplacePatch(origPipeline);
    if (!newPipeline) {
      console.log(`  ${viewName}: no "$results." field refs found — skipping`);
      return;
    }
  }

  // Drop and recreate in dev
  try {
    await devDb.dropCollection(viewName);
  } catch { /* ignore if not exists */ }

  await devDb.createCollection(viewName, { viewOn, pipeline: newPipeline });
  console.log(`  ✓ ${viewName}: recreated with ${strategy} strategy`);
}

async function main() {
  if (!uri) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected\n');

  const devDb = client.db(DEV_DB);
  const prodDb = client.db(PROD_DB);

  // Detect ALL views in prod and auto-assign strategy
  const allProdViews = await prodDb.listCollections({ type: 'view' }).toArray();

  console.log('=== Fixing views ===');
  for (const v of allProdViews) {
    const pipelineStr = JSON.stringify(v.options?.pipeline || []);
    const hasResultsUnwind = (v.options?.pipeline || []).some(
      s => s.$unwind?.path === '$results' || s.$unwind === '$results'
    );
    const hasResultsDotRef = pipelineStr.includes('"$results.');

    if (hasResultsUnwind) {
      // Use wrap strategy — do NOT also do field-ref replacement on these views
      await fixView(prodDb, devDb, v.name, 'wrap');
    } else if (hasResultsDotRef) {
      // Use field-ref replacement strategy
      await fixView(prodDb, devDb, v.name, 'replace');
    }
  }

  // Verify
  console.log('\n=== Verification ===');
  const checkViews = ['AdvancedStandings', 'advanced_standings_view', 'StandingsHelper', 'standings_view', 'Standings', 'StandingsHelper', 'standings2'];
  for (const name of [...new Set(checkViews)]) {
    try {
      const count = await devDb.collection(name).countDocuments();
      console.log(`  ${name}: ${count} docs`);
    } catch (e) {
      console.log(`  ${name}: ERROR — ${e.message.slice(0, 80)}`);
    }
  }

  await client.close();
  console.log('\n✅ Done');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
