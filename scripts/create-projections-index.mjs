// One-time script: create compound index on projections collection for fast season+system lookups
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI not set');

const client = new MongoClient(uri);
await client.connect();
const db = client.db();

const result = await db.collection('projections').createIndex(
  { mlbId: 1, season: 1, projSystem: 1, importedAt: -1 },
  { background: true },
);
console.log('✅ Index created/confirmed:', result);

await client.close();
