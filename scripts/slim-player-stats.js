/**
 * slim-player-stats.js
 *
 * Strips excess fields from players.stats (the MLB seasonStats blob).
 *
 * Before: players.stats = full MLB seasonStats object
 *   { batting: { 30+ fields }, pitching: { 30+ fields }, fielding: { … } }
 *
 * After: players.stats = only the batting fields used by calculateAblScore
 *   { batting: { atBats, hits, doubles, triples, homeRuns, baseOnBalls,
 *                hitByPitch, stolenBases, caughtStealing, pickoffs,
 *                sacBunts, sacFlies } }  (zero values omitted)
 *
 * Usage:
 *   node scripts/slim-player-stats.js             # dev only
 *   node scripts/slim-player-stats.js --prod      # dev + prod
 *   node scripts/slim-player-stats.js --dryrun    # count only, no writes
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

const KEEP_BATTING_FIELDS = [
  'atBats', 'hits', 'doubles', 'triples', 'homeRuns',
  'baseOnBalls', 'hitByPitch', 'stolenBases', 'caughtStealing',
  'pickoffs', 'sacBunts', 'sacFlies',
];

function slimStats(stats) {
  if (!stats || typeof stats !== 'object') return { batting: {} };
  const batting = {};
  for (const field of KEEP_BATTING_FIELDS) {
    const v = Number(stats.batting?.[field] ?? 0);
    if (Number.isFinite(v) && v !== 0) batting[field] = v;
  }
  return { batting };
}

function statsNeedsSlimming(stats) {
  if (!stats || typeof stats !== 'object') return false;
  // Fat if there are keys beyond our keep-set in batting, or pitching/fielding exist
  if (stats.pitching || stats.fielding) return true;
  if (!stats.batting) return false;
  return Object.keys(stats.batting).some((k) => !KEEP_BATTING_FIELDS.includes(k));
}

async function slimDb(db, dbName) {
  console.log(`\n=== Slimming player stats in ${dbName} ===`);

  const total = await db.collection('players').countDocuments({ stats: { $exists: true } });
  console.log(`  Players with stats field: ${total}`);

  if (total === 0) {
    console.log('  Nothing to do.');
    return;
  }

  const cursor = db.collection('players').find({ stats: { $exists: true } });

  let checked = 0, slimmed = 0, alreadySlim = 0;
  const bulk = [];

  for await (const player of cursor) {
    checked++;

    if (!statsNeedsSlimming(player.stats)) {
      alreadySlim++;
      continue;
    }

    slimmed++;
    if (dryRun) continue;

    bulk.push({
      updateOne: {
        filter: { _id: player._id },
        update: { $set: { stats: slimStats(player.stats) } },
      },
    });

    if (bulk.length === 500) {
      await db.collection('players').bulkWrite(bulk, { ordered: false });
      bulk.length = 0;
      process.stdout.write('.');
    }
  }

  if (bulk.length > 0) {
    await db.collection('players').bulkWrite(bulk, { ordered: false });
  }

  console.log(`\n  Checked: ${checked}, Slimmed: ${slimmed}, Already slim: ${alreadySlim}`);
  if (dryRun && slimmed > 0) {
    console.log(`  [dryrun] Would slim ${slimmed} player documents.`);
  }
}

async function main() {
  if (!uri) throw new Error('MONGODB_URI not set in .env.local');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB');
  if (dryRun) console.log('[DRY RUN — no writes]');

  try {
    await slimDb(client.db(DEV_DB), DEV_DB);

    if (includeProd) {
      await slimDb(client.db(PROD_DB), PROD_DB);
    } else {
      console.log('\n💡 To also slim prod, run with --prod flag.');
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
