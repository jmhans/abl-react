/**
 * Migrate lineups.effectiveDate from BSON Date → YYYY-MM-DD string.
 *
 * The UTC date portion of the stored timestamp (always T17:00:00Z = noon CDT)
 * is already the correct CT game date, so we just take .toISOString().slice(0,10).
 *
 * Usage:
 *   node scripts/migrate-lineup-effectivedate.mjs           # dev
 *   node scripts/migrate-lineup-effectivedate.mjs --prod    # prod
 *   node scripts/migrate-lineup-effectivedate.mjs --dry-run # preview only
 */
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const isProd = process.argv.includes('--prod');
const isDryRun = process.argv.includes('--dry-run');
const uri = isProd
  ? process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r')
  : process.env.MONGODB_URI;
const dbName = isProd ? 'heroku_wm40bx9r' : 'abl_dev';

console.log(`Migrating lineups.effectiveDate: Date → YYYY-MM-DD string`);
console.log(`DB: ${dbName}  |  dry-run: ${isDryRun}`);

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

// Find all docs where effectiveDate is stored as a BSON Date (not a string)
// MongoDB driver returns Date objects for BSON dates, strings for existing string values.
const all = await db.collection('lineups').find({}).toArray();

let toMigrate = 0;
let alreadyString = 0;
const bulkOps = [];

for (const doc of all) {
  const ed = doc.effectiveDate;
  if (ed instanceof Date) {
    const dateStr = ed.toISOString().slice(0, 10);
    console.log(`  ${doc._id}  team:${doc.ablTeam}  ${ed.toISOString()} → "${dateStr}"`);
    if (!isDryRun) {
      bulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { effectiveDate: dateStr } },
        },
      });
    }
    toMigrate++;
  } else if (typeof ed === 'string') {
    alreadyString++;
  } else {
    console.warn(`  SKIPPED ${doc._id}  unexpected effectiveDate type: ${typeof ed}`);
  }
}

console.log(`\nSummary: ${toMigrate} to migrate, ${alreadyString} already strings`);

if (isDryRun) {
  console.log('Dry run — no changes written.');
} else if (bulkOps.length > 0) {
  const result = await db.collection('lineups').bulkWrite(bulkOps, { ordered: false });
  console.log(`Done. Updated: ${result.modifiedCount}`);
  // Verify
  const postCheck = await db.collection('lineups').find({}).toArray();
  const remaining = postCheck.filter(d => d.effectiveDate instanceof Date).length;
  console.log(`Post-migration Date fields remaining: ${remaining}`);
} else {
  console.log('Nothing to migrate.');
}

await client.close();
