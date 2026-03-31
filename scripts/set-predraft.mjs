// Set ABL 2026 and ABML 2026 to status: 'pre-draft' (isActive stays true)
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

// Set all active seasons that haven't started yet to pre-draft
// (isActive: true means they are the current/upcoming season)
const result = await db.collection('seasons').updateMany(
  { isActive: true },
  { $set: { status: 'pre-draft' } }
);

console.log('Set to pre-draft:', result.modifiedCount, 'seasons');

const all = await db.collection('seasons').find({}).toArray();
for (const s of all) {
  const league = await db.collection('leagues').findOne({ _id: s.leagueId });
  console.log(league?.name, s.year, '→', s.status, 'isActive:', s.isActive);
}

await client.close();
