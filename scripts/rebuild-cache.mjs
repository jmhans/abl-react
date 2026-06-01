import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const prodUri = process.env.MONGODB_URI.replace('/abl_dev', '/heroku_wm40bx9r');
const client = new MongoClient(prodUri);
await client.connect();
const db = client.db('heroku_wm40bx9r');

console.log('🔄 REBUILDING players_cache in prod...\n');

const t0 = Date.now();

// Materialize players_view into players_cache (atomic $out operation)
await db.collection('players_view').aggregate([
  { $out: 'players_cache' },
]).toArray();

// Index for performance
await db.collection('players_cache').createIndex({ mlbID: 1 }, { background: true });

const count = await db.collection('players_cache').countDocuments();
const elapsed = Date.now() - t0;

console.log(`✅ players_cache rebuilt: ${count} docs in ${elapsed}ms`);
console.log('\nFree agents page will now show the updated positions!');

await client.close();
