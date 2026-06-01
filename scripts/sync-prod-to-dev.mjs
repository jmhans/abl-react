/**
 * Copies all persistent collections from prod (heroku_wm40bx9r) → dev (abl_dev).
 * Skips views (type === 'view'). Safe to re-run — each collection is dropped then repopulated.
 *
 * Usage:  node scripts/sync-prod-to-dev.mjs
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
let mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  try {
    const envPath = resolve(__dirname, '..', '.env.local');
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^MONGODB_URI=(.+)$/);
      if (m) { mongoUri = m[1].trim().replace(/^['"]|['"]$/g, ''); break; }
    }
  } catch { /* ignore */ }
}
if (!mongoUri) { console.error('❌ MONGODB_URI not found'); process.exit(1); }

const PROD_DB = 'heroku_wm40bx9r';
const DEV_DB  = 'abl_dev';

// MONGODB_URI point at dev — swap the db name to reach prod
const prodUri = mongoUri.replace(`/${DEV_DB}`, `/${PROD_DB}`);

const client = new MongoClient(prodUri);
await client.connect();

const prodDb = client.db(PROD_DB);
const devDb  = client.db(DEV_DB);

// List all collections, exclude views
const allInfos = await prodDb.listCollections().toArray();
const collections = allInfos.filter(c => c.type !== 'view');
const skipped     = allInfos.length - collections.length;

console.log(`\n📦 Syncing ${collections.length} collections from prod → dev (skipping ${skipped} views)\n`);

let totalDocs = 0;
for (const info of collections) {
  const name = info.name;
  const prodCol = prodDb.collection(name);
  const devCol  = devDb.collection(name);

  // Drop dev collection (ignore "ns not found")
  try { await devDb.dropCollection(name); } catch (e) { if (e.code !== 26) throw e; }

  const docs = await prodCol.find({}).toArray();
  if (docs.length > 0) await devCol.insertMany(docs);

  console.log(`  ✓ ${name.padEnd(40)} ${docs.length} docs`);
  totalDocs += docs.length;
}

await client.close();
console.log(`\n✅ Done — ${totalDocs} total documents synced to ${DEV_DB}`);
console.log('\nℹ️  Views were skipped. Run scripts/recreate-dev-views.js if you need to refresh them.\n');
