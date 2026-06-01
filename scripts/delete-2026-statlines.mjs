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

console.log('🔴 DELETING ALL 2026 STATLINES (contaminated with spring training)...\n');

const result = await db.collection('statlines').deleteMany({ _id: { $regex: '^2026-' } });
console.log(`✅ Deleted ${result.deletedCount} statline documents for 2026`);
console.log('\nNow ready to re-backfill with regular season games only.');

await client.close();
