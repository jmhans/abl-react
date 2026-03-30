// One-time script: delete ABL 2023 and 2024 phantom seasons (no game data)
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
const db = client.db('abl_dev');

// Find ABL league
const abl = await db.collection('leagues').findOne({ slug: 'abl' });
if (!abl) throw new Error('ABL league not found');
console.log('ABL league id:', abl._id.toString());

// Show phantom seasons before deletion
const phantom = await db.collection('seasons').find({
  leagueId: abl._id,
  year: { $in: [2023, 2024] },
}).toArray();
console.log('Phantom seasons to delete:', phantom.map(s => ({ id: s._id, year: s.year, status: s.status })));

if (phantom.length === 0) {
  console.log('Nothing to delete.');
} else {
  const result = await db.collection('seasons').deleteMany({
    leagueId: abl._id,
    year: { $in: [2023, 2024] },
  });
  console.log('Deleted:', result.deletedCount);
}

// Confirm remaining seasons
const remaining = await db.collection('seasons').find({ leagueId: abl._id }).toArray();
console.log('Remaining ABL seasons:', remaining.map(s => ({ year: s.year, status: s.status })));

await client.close();
console.log('Done.');
