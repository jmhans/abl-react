/**
 * patch-lineup-acqtype.mjs
 *
 * Repairs lineup roster entries that are missing acqType by cross-referencing
 * completed draft picks. Safe to re-run — only updates docs that need it.
 *
 * Logic:
 *   For each completed draft, collect playerId → 'draft' mapping.
 *   For each lineup doc whose roster contains players from that draft,
 *   set acqType: 'draft' on any entry where acqType is missing/null.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const isProd = process.argv.includes('--prod');
const PROD_DB = 'heroku_wm40bx9r';
const DEV_DB  = 'abl_dev';
const uri = isProd
  ? process.env.MONGODB_URI.replace(`/${DEV_DB}`, `/${PROD_DB}`)
  : process.env.MONGODB_URI;

console.log(`\n🎯 Target: ${isProd ? `PROD (${PROD_DB})` : `dev (${DEV_DB})`}\n`);

const client = new MongoClient(uri);
await client.connect();
const db = client.db(isProd ? PROD_DB : DEV_DB);

// Build a set of playerIds that were drafted (from all completed drafts)
const completedDrafts = await db.collection('drafts')
  .find({ status: 'completed' })
  .toArray();

console.log(`Found ${completedDrafts.length} completed draft(s)`);

const draftedPlayerIds = new Set();
for (const draft of completedDrafts) {
  for (const entry of (draft.picks ?? [])) {
    if (entry.playerId) draftedPlayerIds.add(String(entry.playerId));
  }
}
console.log(`Total drafted player IDs: ${draftedPlayerIds.size}`);

// Fetch all lineup docs
const lineups = await db.collection('lineups').find({}).toArray();
console.log(`\nChecking ${lineups.length} lineup doc(s)...\n`);

let docsPatched = 0;
let entriesPatched = 0;

for (const lineup of lineups) {
  const roster = lineup.roster ?? [];
  let dirty = false;

  const patchedRoster = roster.map((entry) => {
    if (entry.acqType) return entry; // already set — leave alone
    const playerId = String(entry.player);
    if (draftedPlayerIds.has(playerId)) {
      dirty = true;
      entriesPatched++;
      return { ...entry, acqType: 'draft' };
    }
    return entry;
  });

  if (dirty) {
    await db.collection('lineups').updateOne(
      { _id: lineup._id },
      { $set: { roster: patchedRoster } }
    );
    docsPatched++;
    console.log(`  ✓ lineup ${lineup._id} (team ${lineup.ablTeam}) — patched ${patchedRoster.filter((e, i) => e.acqType && !roster[i].acqType).length} entr(ies)`);
  }
}

await client.close();
console.log(`\nDone. ${entriesPatched} roster entries patched across ${docsPatched} lineup doc(s).`);
