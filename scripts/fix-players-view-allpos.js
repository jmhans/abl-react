/**
 * fix-players-view-allpos.js
 *
 * Fixes the players_view pipeline so CommishPos is ALWAYS included in
 * eligible positions, supplemented by any 10+ game qualifiers — instead of
 * the current logic that replaces CommishPos once any earned positions exist.
 *
 * Old logic (broken):
 *   if eligiblePositions.length > 0 → use ONLY eligiblePositions (CommishPos dropped)
 *   else                            → use [CommishPos ?? prior year fallback]
 *
 * New logic (correct):
 *   always include CommishPos (if set) UNION earned positions (10+ games)
 *   fallback to [prior year max] only if both CommishPos and earned are empty
 *
 * Usage:
 *   node scripts/fix-players-view-allpos.js           # updates both dev and prod
 *   node scripts/fix-players-view-allpos.js --dev     # dev only
 *   node scripts/fix-players-view-allpos.js --prod    # prod only
 */

const { MongoClient } = require('mongodb');
const fs   = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=\r]+)=(.*\S*)/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const PROD_DB = 'heroku_wm40bx9r';
const DEV_DB  = 'abl_dev';

const args = process.argv.slice(2);
const devOnly  = args.includes('--dev');
const prodOnly = args.includes('--prod');
const targets  = devOnly  ? [DEV_DB]
               : prodOnly ? [PROD_DB]
               : [DEV_DB, PROD_DB];

/** The corrected allPos stage — always include CommishPos, union with earned */
const NEW_ALLPOS_STAGE = {
  $addFields: {
    allPos: {
      $let: {
        vars: {
          // CommishPos as a single-element array, or [] if none set
          commishArr: {
            $cond: [
              { $gt: [{ $size: '$tempCommish' }, 0] },
              [{ $first: '$tempCommish.CommishPos' }],
              []
            ]
          },
          // Positions earned via 10+ games this season
          earnedArr: { $ifNull: ['$newPosLog.curr', []] }
        },
        in: {
          $cond: [
            // If we have anything (CommishPos or earned), union them
            {
              $gt: [
                { $add: [{ $size: '$$commishArr' }, { $size: '$$earnedArr' }] },
                0
              ]
            },
            { $setUnion: ['$$commishArr', '$$earnedArr'] },
            // Fallback to prior-year max only when truly nothing applies
            [{ $ifNull: ['$newPosLog.prior', '$newPosLog.curr_max'] }]
          ]
        }
      }
    }
  }
};

async function fixView(db) {
  const dbName = db.databaseName;

  // Get the current view definition
  const infos = await db.listCollections({ name: 'players_view' }).toArray();
  if (!infos.length) {
    console.log(`  ⚠ players_view not found in ${dbName} — skipping`);
    return;
  }

  const { options: { viewOn, pipeline } } = infos[0];
  console.log(`  Current pipeline has ${pipeline.length} stage(s)`);

  // Find the allPos $addFields stage
  const idx = pipeline.findIndex(
    (s) => s.$addFields && s.$addFields.allPos !== undefined
  );
  if (idx === -1) {
    console.log(`  ⚠ Could not locate allPos stage in ${dbName} pipeline — aborting`);
    return;
  }

  console.log(`  Found allPos stage at index ${idx}`);
  pipeline[idx] = NEW_ALLPOS_STAGE;

  // Apply via collMod
  await db.command({ collMod: 'players_view', viewOn, pipeline });
  console.log(`  ✅ players_view updated in ${dbName}`);
}

async function verifyMcGonigle(db) {
  const result = await db.collection('players_view').findOne({ mlbID: '805808' });
  if (!result) {
    console.log('  ⚠ McGonigle not found in players_view');
    return;
  }
  console.log(`  McGonigle eligible: ${JSON.stringify(result.eligible)}`);
}

async function main() {
  const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGODB_URI_DIRECT not set in .env.local');

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB\n');

  try {
    for (const dbName of targets) {
      console.log(`--- ${dbName} ---`);
      const db = client.db(dbName);
      await fixView(db);
      await verifyMcGonigle(db);
      console.log();
    }
    console.log('Done. Run rebuildPlayersCache (Admin → Sync Positions) to propagate to players_cache.');
  } finally {
    await client.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
