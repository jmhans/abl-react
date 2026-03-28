/**
 * seed-leagues-and-seasons.js
 *
 * Phase 1 of multi-league support:
 *   1. Creates the `leagues` collection with the ABL league doc
 *   2. Creates the `seasons` collection with ABL seasons 2023, 2024, 2025
 *      - 2023, 2024 → status: "completed"
 *      - 2025 → status: "active"
 *      - All 10 existing teams participate in all seasons
 *   3. Backfills leagueId + seasonId onto:
 *      - games       (all 2025)
 *      - drafts      (season string → seasonId, 4 recent unseasonened → 2025)
 *      - draftpicks  (season string → seasonId)
 *      - lineups     (leagueId only — not season-specific)
 *
 * Usage:
 *   node scripts/seed-leagues-and-seasons.js             # dev only
 *   node scripts/seed-leagues-and-seasons.js --prod      # dev + prod
 *   node scripts/seed-leagues-and-seasons.js --dryrun    # preview, no writes
 */

const { MongoClient, ObjectId } = require('mongodb');
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

// Stable IDs so re-running is idempotent
const ABL_LEAGUE_ID   = new ObjectId('aaaaaa000000000000000001');
const SEASON_2023_ID  = new ObjectId('bbbbbb000000000000002023');
const SEASON_2024_ID  = new ObjectId('bbbbbb000000000000002024');
const SEASON_2025_ID  = new ObjectId('bbbbbb000000000000002025');

const SEASON_BY_YEAR = {
  '2023': SEASON_2023_ID,
  '2024': SEASON_2024_ID,
  '2025': SEASON_2025_ID,
};

async function run(db, dbName) {
  console.log(`\n=== ${dbName} ===`);

  // ── 1. Get all team IDs ──────────────────────────────────────────────────
  const teamDocs = await db.collection('ablteams').find({}, { projection: { _id: 1 } }).toArray();
  const teamIds = teamDocs.map(t => t._id);
  console.log(`  Teams found: ${teamIds.length}`);

  // ── 2. Seed leagues ──────────────────────────────────────────────────────
  const leagueDoc = {
    _id: ABL_LEAGUE_ID,
    name: 'Actuarial Baseball League',
    shortName: 'ABL',
    slug: 'abl',
    createdAt: new Date('2023-01-01'),
  };

  if (dryRun) {
    console.log('  [dryrun] Would upsert league:', leagueDoc.slug);
  } else {
    await db.collection('leagues').updateOne(
      { _id: ABL_LEAGUE_ID },
      { $set: leagueDoc },
      { upsert: true }
    );
    console.log('  ✓ leagues: upserted ABL');
  }

  // ── 3. Seed seasons ──────────────────────────────────────────────────────
  const seasonDocs = [
    {
      _id: SEASON_2023_ID,
      leagueId: ABL_LEAGUE_ID,
      year: 2023,
      slug: '2023',
      name: '2023 Season',
      status: 'completed',
      startDate: new Date('2023-04-01'),
      endDate: new Date('2023-08-31'),
      teamIds,
    },
    {
      _id: SEASON_2024_ID,
      leagueId: ABL_LEAGUE_ID,
      year: 2024,
      slug: '2024',
      name: '2024 Season',
      status: 'completed',
      startDate: new Date('2024-04-01'),
      endDate: new Date('2024-08-31'),
      teamIds,
    },
    {
      _id: SEASON_2025_ID,
      leagueId: ABL_LEAGUE_ID,
      year: 2025,
      slug: '2025',
      name: '2025 Season',
      status: 'active',
      startDate: new Date('2025-04-15'),
      endDate: new Date('2025-08-31'),
      teamIds,
    },
  ];

  if (dryRun) {
    console.log('  [dryrun] Would upsert seasons:', seasonDocs.map(s => s.slug).join(', '));
  } else {
    for (const s of seasonDocs) {
      await db.collection('seasons').updateOne({ _id: s._id }, { $set: s }, { upsert: true });
    }
    console.log('  ✓ seasons: upserted 2023, 2024, 2025');
  }

  // ── 4. Backfill games ────────────────────────────────────────────────────
  const gameCount = await db.collection('games').countDocuments({ leagueId: { $exists: false } });
  console.log(`  Games needing backfill: ${gameCount}`);
  if (!dryRun && gameCount > 0) {
    const result = await db.collection('games').updateMany(
      { leagueId: { $exists: false } },
      { $set: { leagueId: ABL_LEAGUE_ID, seasonId: SEASON_2025_ID } }
    );
    console.log(`  ✓ games: backfilled ${result.modifiedCount}`);
  }

  // ── 5. Backfill drafts ───────────────────────────────────────────────────
  const drafts = await db.collection('drafts').find({ leagueId: { $exists: false } }).toArray();
  console.log(`  Drafts needing backfill: ${drafts.length}`);
  if (!dryRun && drafts.length > 0) {
    const bulk = drafts.map(d => {
      const seasonId = SEASON_BY_YEAR[d.season] || SEASON_2025_ID;
      return {
        updateOne: {
          filter: { _id: d._id },
          update: { $set: { leagueId: ABL_LEAGUE_ID, seasonId, year: Number(d.season) || 2025 } },
        },
      };
    });
    await db.collection('drafts').bulkWrite(bulk, { ordered: false });
    console.log(`  ✓ drafts: backfilled ${bulk.length}`);
  }

  // ── 6. Backfill draftpicks ───────────────────────────────────────────────
  const dpCount = await db.collection('draftpicks').countDocuments({ leagueId: { $exists: false } });
  console.log(`  Draftpicks needing backfill: ${dpCount}`);
  if (!dryRun && dpCount > 0) {
    // Group by season string and update in batches
    for (const [seasonStr, seasonId] of Object.entries(SEASON_BY_YEAR)) {
      const r = await db.collection('draftpicks').updateMany(
        { season: seasonStr, leagueId: { $exists: false } },
        { $set: { leagueId: ABL_LEAGUE_ID, seasonId } }
      );
      if (r.modifiedCount) console.log(`    draftpicks season ${seasonStr}: ${r.modifiedCount}`);
    }
    // Any remaining (no season field) → 2025
    const r2 = await db.collection('draftpicks').updateMany(
      { leagueId: { $exists: false } },
      { $set: { leagueId: ABL_LEAGUE_ID, seasonId: SEASON_2025_ID } }
    );
    if (r2.modifiedCount) console.log(`    draftpicks (no season): ${r2.modifiedCount}`);
    console.log(`  ✓ draftpicks: done`);
  }

  // ── 7. Backfill lineups ──────────────────────────────────────────────────
  const luCount = await db.collection('lineups').countDocuments({ leagueId: { $exists: false } });
  console.log(`  Lineups needing backfill: ${luCount}`);
  if (!dryRun && luCount > 0) {
    const r = await db.collection('lineups').updateMany(
      { leagueId: { $exists: false } },
      { $set: { leagueId: ABL_LEAGUE_ID, seasonId: SEASON_2025_ID } }
    );
    console.log(`  ✓ lineups: backfilled ${r.modifiedCount}`);
  }

  if (dryRun) console.log('  [dryrun] No writes performed.');
}

async function main() {
  if (!uri) throw new Error('MONGODB_URI not set in .env.local');
  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB');
  if (dryRun) console.log('[DRY RUN — no writes]');

  try {
    await run(client.db(DEV_DB), DEV_DB);
    if (includeProd) {
      await run(client.db(PROD_DB), PROD_DB);
    } else {
      console.log('\n💡 Run with --prod to also seed prod.');
    }
    console.log('\n✅ Done.');
  } finally {
    await client.close();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
