/**
 * copy-lineups-to-prod.js
 *
 * Copies all lineup docs from abl_dev (dev) into heroku_wm40bx9r (prod)
 * on the same MongoDB cluster.
 *
 * For each lineup doc found in dev:
 *   - If no doc with the same ablTeam + effectiveDate exists in prod → INSERT
 *   - If one already exists → SKIP (unless --force, which REPLACEs it)
 *
 * Pass --dry-run to preview without writing.
 * Pass --force to overwrite existing docs in prod.
 *
 * Usage:
 *   node scripts/copy-lineups-to-prod.js [--dry-run] [--force]
 */
const { MongoClient } = require('mongodb');
const fs = require('fs');

for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=\r]+)=(.+)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

// Same cluster, different databases
const BASE_URI = process.env.MONGODB_URI; // points to abl_dev
const PROD_URI = BASE_URI.replace('/abl_dev', '/heroku_wm40bx9r');

async function main() {
  console.log('Source DB: abl_dev');
  console.log('Target DB: heroku_wm40bx9r');
  console.log('DRY_RUN:', DRY_RUN, ' FORCE:', FORCE, '\n');

  const client = new MongoClient(BASE_URI);
  await client.connect();

  const devDb  = client.db('abl_dev');
  const prodDb = client.db('heroku_wm40bx9r');

  // Load all dev lineups
  const devLineups = await devDb.collection('lineups').find({}).toArray();
  console.log(`Dev lineups found: ${devLineups.length}`);

  // Count existing prod lineups for context
  const prodCount = await prodDb.collection('lineups').countDocuments();
  console.log(`Prod lineups currently: ${prodCount}\n`);

  // Team names for readable output
  const teamDocs = await devDb.collection('ablteams').find({}).toArray();
  const teamName = new Map(teamDocs.map(t => [t._id.toString(), t.nickname || t.name || t._id.toString()]));

  let inserted = 0, replaced = 0, skipped = 0;

  for (const doc of devLineups) {
    const { _id, ...rest } = doc; // strip _id so we don't conflict
    const tid = rest.ablTeam?.toString();
    const name = teamName.get(tid) || tid;
    const label = `${name} [${rest.effectiveDate}] roster=${rest.roster?.length}`;

    const existing = await prodDb.collection('lineups').findOne({
      ablTeam: rest.ablTeam,
      effectiveDate: rest.effectiveDate,
    });

    if (existing && !FORCE) {
      console.log(`  SKIP    ${label} (already in prod)`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ${existing ? 'REPLACE' : 'INSERT '}  ${label} [DRY RUN]`);
      existing ? replaced++ : inserted++;
      continue;
    }

    if (existing) {
      await prodDb.collection('lineups').replaceOne(
        { ablTeam: rest.ablTeam, effectiveDate: rest.effectiveDate },
        rest
      );
      console.log(`  REPLACED ${label}`);
      replaced++;
    } else {
      await prodDb.collection('lineups').insertOne(rest);
      console.log(`  INSERTED ${label}`);
      inserted++;
    }
  }

  const prodCountAfter = DRY_RUN ? prodCount : await prodDb.collection('lineups').countDocuments();
  console.log(`\nDone. Inserted: ${inserted}, Replaced: ${replaced}, Skipped: ${skipped}`);
  console.log(`Prod lineup count: ${prodCount} → ${prodCountAfter}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
