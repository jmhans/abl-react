/**
 * patch-lineup-positions.mjs
 *
 * One-time: for every lineup roster entry that has no lineupPosition set,
 * assign the player's first eligible position (same logic as /api/draft/finalize).
 *
 * Uses players_cache for eligible data (falls back to players collection).
 * Safe to re-run — only touches entries where lineupPosition is null/missing.
 *
 * Usage:
 *   node scripts/patch-lineup-positions.mjs           # dev
 *   node scripts/patch-lineup-positions.mjs --prod    # prod
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

// Replicate getDraftEligiblePositions from draft-utils.ts
function getEligiblePositions(player) {
  if (Array.isArray(player.eligible) && player.eligible.length > 0) return player.eligible;
  if (player.position) return [player.position];
  if (player.mlbPosition) {
    const pos = player.mlbPosition.toUpperCase();
    if (pos.includes('C'))  return ['C'];
    if (pos.includes('1B')) return ['1B'];
    if (pos.includes('2B')) return ['2B'];
    if (pos.includes('3B')) return ['3B'];
    if (pos.includes('SS')) return ['SS'];
    if (pos.includes('OF')) return ['OF'];
    if (pos.includes('DH')) return ['DH'];
  }
  return [];
}

// Collect all player IDs that need positions across all lineups
const lineups = await db.collection('lineups').find({}).toArray();
console.log(`Found ${lineups.length} lineup doc(s)`);

const neededPlayerIds = new Set();
for (const lineup of lineups) {
  for (const entry of (lineup.roster ?? [])) {
    if (!entry.lineupPosition) {
      neededPlayerIds.add(String(entry.player));
    }
  }
}
console.log(`Roster entries missing lineupPosition: ${neededPlayerIds.size}`);

if (neededPlayerIds.size === 0) {
  console.log('\n✅ Nothing to patch.');
  await client.close();
  process.exit(0);
}

// Fetch player docs from players_cache (fall back to players collection)
const cacheCount = await db.collection('players_cache').estimatedDocumentCount();
const sourceCollection = cacheCount > 0 ? 'players_cache' : 'players';
const playerDocs = await db.collection(sourceCollection)
  .find({ _id: { $in: [...neededPlayerIds].map(id => new ObjectId(id)) } })
  .project({ _id: 1, eligible: 1, position: 1, mlbPosition: 1, name: 1 })
  .toArray();

const playerMap = new Map(playerDocs.map(p => [p._id.toString(), p]));
console.log(`Loaded ${playerMap.size} player docs from ${sourceCollection}\n`);

let docsPatched = 0;
let entriesPatched = 0;
let entriesUnresolved = 0;

for (const lineup of lineups) {
  const roster = lineup.roster ?? [];
  let dirty = false;

  const patchedRoster = roster.map((entry) => {
    if (entry.lineupPosition) return entry; // already set

    const player = playerMap.get(String(entry.player));
    const eligible = player ? getEligiblePositions(player) : [];
    const pos = eligible[0] ?? null;

    if (pos) {
      dirty = true;
      entriesPatched++;
      return { ...entry, lineupPosition: pos };
    } else {
      entriesUnresolved++;
      if (player) console.warn(`  ⚠️  No eligible position for player ${player.name} (${entry.player})`);
      else console.warn(`  ⚠️  Player ${entry.player} not found in ${sourceCollection}`);
      return entry;
    }
  });

  if (dirty) {
    await db.collection('lineups').updateOne(
      { _id: lineup._id },
      { $set: { roster: patchedRoster } }
    );
    docsPatched++;
    const count = patchedRoster.filter((e, i) => e.lineupPosition && !roster[i].lineupPosition).length;
    console.log(`  ✓ lineup ${lineup._id} (team ${lineup.ablTeam}) — set lineupPosition on ${count} entr(ies)`);
  }
}

await client.close();
console.log(`\nDone. ${entriesPatched} entries patched across ${docsPatched} lineup doc(s).`);
if (entriesUnresolved > 0) {
  console.log(`⚠️  ${entriesUnresolved} entries could not be resolved (no eligibility data).`);
}
