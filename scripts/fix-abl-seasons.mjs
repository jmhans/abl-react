import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=\r]+)=(.*\S*)/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('abl_dev');

const abl = await db.collection('leagues').findOne({ slug: 'abl' });

const r1 = await db.collection('seasons').updateOne(
  { leagueId: abl._id, year: 2025 },
  { $set: { isActive: false, status: 'completed' } }
);
const r2 = await db.collection('seasons').updateOne(
  { leagueId: abl._id, year: 2026 },
  { $set: { isActive: true, status: 'active' } }
);

console.log('ABL 2025 → completed:', r1.modifiedCount);
console.log('ABL 2026 → active:   ', r2.modifiedCount);

const all = await db.collection('seasons').find({ leagueId: abl._id }).sort({ year: 1 }).toArray();
all.forEach(s => console.log(s.year, s.status, 'isActive:', s.isActive));

await client.close();
