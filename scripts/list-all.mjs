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
const db = client.db(process.env.MONGODB_DB || 'abl_dev');

console.log('\n📋 All Drafts:');
const drafts = await db.collection('drafts').find({}).toArray();
for (const draft of drafts) {
  const season = await db.collection('seasons').findOne({ _id: draft.seasonId });
  console.log(`  ${draft._id} | Season: ${season?.year} | Picks: ${draft.picks?.length || 0} | Status: ${draft.status}`);
}

console.log('\n📋 All Seasons:');
const seasons = await db.collection('seasons').find({}).toArray();
for (const season of seasons) {
  console.log(`  ${season._id} | Year: ${season.year} | Status: ${season.status}`);
}

await client.close();
