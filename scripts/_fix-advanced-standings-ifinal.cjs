const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/); if (m) process.env[m[1].trim()] = m[2].trim();
}

const VIEW = 'advanced_standings_view';

async function fixDb(label, uri, dbName) {
  console.log(`\n[${label}] Connecting to ${dbName}...`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const def = await db.listCollections({ name: VIEW }).next();
  if (!def) {
    console.log(`  ❌ View '${VIEW}' not found — skipping.`);
    await client.close();
    return;
  }

  const pipeline = def.options.pipeline;
  const viewOn = def.options.viewOn;
  console.log(`  Found '${VIEW}' on '${viewOn}' with ${pipeline.length} stages.`);

  // Check current stage 1
  const stage1 = pipeline[0];
  console.log(`  Stage 1 (before): ${JSON.stringify(stage1)}`);

  if (stage1.$match?.['result.isFinal']) {
    console.log(`  ✓ Already has isFinal filter — no change needed.`);
    await client.close();
    return;
  }

  // Patch stage 1: add isFinal filter
  pipeline[0] = {
    $match: {
      ...stage1.$match,
      'result.isFinal': { $ne: false },
    },
  };
  console.log(`  Stage 1 (after):  ${JSON.stringify(pipeline[0])}`);

  // Drop and recreate the view
  await db.collection(VIEW).drop().catch(() => {});
  await db.createCollection(VIEW, { viewOn, pipeline });
  console.log(`  ✓ '${VIEW}' recreated with isFinal filter on [${label}]`);

  await client.close();
}

async function main() {
  const devUri = process.env.MONGODB_URI;
  const prodUri = process.env.MONGODB_URI.replace('abl_dev', 'heroku_wm40bx9r');

  await fixDb('DEV',  devUri,  'abl_dev');
  await fixDb('PROD', prodUri, 'heroku_wm40bx9r');

  console.log('\nDone.');
}
main().catch(e => { console.error(e); process.exit(1); });
