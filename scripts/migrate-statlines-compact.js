/**
 * migrate-statlines-compact.js
 *
 * Converts statlines from one-doc-per-player-game to one-doc-per-ablDate.
 *
 * BEFORE (per-game doc, ~125k–174k docs):
 *   { _id: ObjectId, mlbId, gamePk, ablDate, stats: { batting: {30+ fields}, fielding }, positions, statlineType, ... }
 *
 * AFTER (per-date doc, ~350–500 docs):
 *   { _id: "2025-04-15",
 *     p: {
 *       "669134_748266": { b: { ab: 2, h: 1 }, pos: ["C"], t: "Final" },
 *       "594798_748267": { b: { hr: 1, ab: 4, h: 2 }, pos: ["SS"] },
 *       ...
 *     }
 *   }
 *
 * Key format: "{mlbId}_{gamePk}"
 * b fields: g, ab, h, 2b, 3b, hr, bb, ibb, hbp, sb, cs, sac, sf, po, e, pb
 *   (zero values omitted to save space)
 *
 * Usage:
 *   node scripts/migrate-statlines-compact.js             # dev only
 *   node scripts/migrate-statlines-compact.js --prod      # dev + prod
 *   node scripts/migrate-statlines-compact.js --dryrun    # count/preview, no writes
 */

const { MongoClient } = require('mongodb');
const fs = require('fs'), path = require('path');

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

const BATTING_SHORT = {
  gamesPlayed: 'g', atBats: 'ab', hits: 'h', doubles: '2b', triples: '3b',
  homeRuns: 'hr', baseOnBalls: 'bb', intentionalWalks: 'ibb', hitByPitch: 'hbp',
  stolenBases: 'sb', caughtStealing: 'cs', sacBunts: 'sac', sacFlies: 'sf',
  pickoffs: 'po',
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function encodeEntry(doc) {
  const s = doc.stats || {};
  const batting = s.batting || s; // handle both nested and already-flat
  const b = {};

  for (const [long, short] of Object.entries(BATTING_SHORT)) {
    const v = toNum(batting[long]);
    if (v !== 0) b[short] = v;
  }
  // Also handle already-short fields (updatedStats / modified format)
  for (const short of ['g','ab','h','2b','3b','hr','bb','ibb','hbp','sb','cs','sac','sf','po']) {
    if (!(short in b)) {
      const v = toNum(batting[short]);
      if (v !== 0) b[short] = v;
    }
  }
  const e = toNum(s?.fielding?.e);
  const pb = toNum(s?.fielding?.pb);
  if (e) b.e = e;
  if (pb) b.pb = pb;

  const entry = { b };
  if (Array.isArray(doc.positions) && doc.positions.length) entry.pos = doc.positions;
  if (doc.statlineType) entry.t = doc.statlineType;
  return entry;
}

async function migrate(db, dbName) {
  console.log(`\n=== Migrating statlines in ${dbName} ===`);

  // Count old-format docs (have ablDate field, ObjectId _id)
  const oldCount = await db.collection('statlines').countDocuments({ ablDate: { $exists: true } });
  const newCount = await db.collection('statlines').countDocuments({ p: { $exists: true } });
  console.log(`  Old-format docs (to migrate): ${oldCount}`);
  console.log(`  New-format docs (already done): ${newCount}`);

  if (oldCount === 0) {
    console.log('  Nothing to do.');
    return;
  }

  // Group old docs by ablDate in memory (they're small after slimming)
  console.log('  Reading old docs...');
  const cursor = db.collection('statlines').find({ ablDate: { $exists: true } });

  const byDate = new Map(); // ablDate → { [mlbId_gamePk]: entry }
  let read = 0;

  for await (const doc of cursor) {
    const key = `${doc.mlbId}_${doc.gamePk}`;
    if (!byDate.has(doc.ablDate)) byDate.set(doc.ablDate, {});
    byDate.get(doc.ablDate)[key] = encodeEntry(doc);
    read++;
  }

  console.log(`  Read ${read} docs across ${byDate.size} dates.`);

  if (dryRun) {
    // Show a sample of what the new docs look like
    const sampleDate = byDate.keys().next().value;
    const sampleDoc = byDate.get(sampleDate);
    const sampleKeys = Object.keys(sampleDoc).slice(0, 3);
    console.log(`\n  [dryrun] Sample new doc for ${sampleDate}:`);
    console.log(`    { _id: "${sampleDate}", p: {`);
    for (const k of sampleKeys) {
      console.log(`      "${k}": ${JSON.stringify(sampleDoc[k])}`);
    }
    console.log(`      ... (${Object.keys(sampleDoc).length} total entries)`);
    console.log(`    }}`);
    console.log(`\n  [dryrun] Would write ${byDate.size} new docs and delete ${read} old docs.`);
    return;
  }

  // Write new date docs in batches
  console.log('  Writing new date docs...');
  const dates = [...byDate.entries()];
  const BATCH = 50;
  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = dates.slice(i, i + BATCH);
    await db.collection('statlines').bulkWrite(
      batch.map(([ablDate, p]) => ({
        updateOne: {
          filter: { _id: ablDate },
          update: { $set: { p } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    process.stdout.write('.');
  }

  // Delete old-format docs
  console.log('\n  Deleting old per-game docs...');
  const deleteResult = await db.collection('statlines').deleteMany({ ablDate: { $exists: true } });
  console.log(`  Deleted ${deleteResult.deletedCount} old docs.`);

  // Final counts
  const finalCount = await db.collection('statlines').countDocuments();
  console.log(`  Final collection size: ${finalCount} docs`);
}

async function main() {
  if (!uri) throw new Error('MONGODB_URI not set in .env.local');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB');
  if (dryRun) console.log('[DRY RUN — no writes]');

  try {
    await migrate(client.db(DEV_DB), DEV_DB);

    if (includeProd) {
      await migrate(client.db(PROD_DB), PROD_DB);
    } else {
      console.log('\n💡 To also migrate prod, run with --prod flag.');
    }

    console.log('\n✅ Done.');
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
