import { MongoClient, ObjectId } from 'mongodb';
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

// Find ABL 2026 season
const abl = await db.collection('leagues').findOne({ slug: 'abl' });
const season2026 = await db.collection('seasons').findOne({ leagueId: abl._id, year: 2026 });
console.log('ABL 2026 seasonId:', season2026._id.toString());

// Re-point the completed draft to ABL 2026
const draftUpdate = await db.collection('drafts').updateOne(
  { _id: new ObjectId('69c495629b10ad7a84785163') },
  { $set: { seasonId: season2026._id.toString(), year: 2026 } }
);
console.log('Draft updated:', draftUpdate.modifiedCount, 'doc(s)');

// Mark ABL 2026 as active (draft is done)
const seasonUpdate = await db.collection('seasons').updateOne(
  { _id: season2026._id },
  { $set: { status: 'active' } }
);
console.log('ABL 2026 season → active:', seasonUpdate.modifiedCount, 'doc(s)');

await client.close();
